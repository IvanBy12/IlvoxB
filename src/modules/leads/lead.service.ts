import type { AuditContext } from "../../common/audit/audit.js";
import type { AuthorizationService } from "../../common/auth/authorization.service.js";
import type { ActorContext, AuthorizedRepositoryScope } from "../../common/auth/authorization.types.js";
import { AppError } from "../../common/errors/app-error.js";
import { ErrorCode } from "../../common/errors/error-codes.js";
import { canTransitionLead, type LeadStatus } from "../../common/state-machines/lead-transitions.js";
import type {
  LeadCommercialPatch,
  LeadConversionInput,
  LeadListInput,
  LeadRepository,
  PublicLeadInput,
} from "./lead.types.js";
import type { NotificationDispatchTrigger } from "../email-notifications/email-notification.dispatcher.js";

export class LeadService {
  constructor(
    private readonly repository: LeadRepository,
    private readonly authorization: AuthorizationService,
    private readonly notificationDispatch?: NotificationDispatchTrigger,
  ) {}

  async createPublic(input: PublicLeadInput, audit: AuditContext) {
    if (input.diagnosticId !== undefined && input.source !== "diagnostic") {
      throw new AppError({
        code: ErrorCode.ValidationError,
        message: "diagnosticId is only accepted for diagnostic leads",
        statusCode: 400,
      });
    }
    try {
      const lead = await this.repository.createPublic({
        ...input,
        fullName: input.fullName.trim(),
        email: input.email.trim().toLowerCase(),
        message: input.message.trim(),
        ...(input.companyName === undefined ? {} : { companyName: input.companyName.trim() }),
        ...(input.phone === undefined ? {} : { phone: input.phone.trim() }),
      }, audit);
      this.notificationDispatch?.trigger();
      return lead;
    } catch (error) {
      if ((error as { readonly code?: string }).code === "ILVOX_SERVICE_NOT_FOUND") {
        throw this.notFound("Service");
      }
      if ((error as { readonly code?: string }).code === "ILVOX_DIAGNOSTIC_NOT_FOUND") {
        throw this.notFound("Diagnostic");
      }
      if ((error as { readonly code?: string }).code === "ILVOX_DIAGNOSTIC_EXPIRED") {
        throw new AppError({ code: ErrorCode.Conflict, message: "Diagnostic has expired", statusCode: 409 });
      }
      if ((error as { readonly code?: string }).code === "ILVOX_DIAGNOSTIC_CLAIMED") {
        throw new AppError({ code: ErrorCode.Conflict, message: "Diagnostic is already linked to a lead", statusCode: 409 });
      }
      throw error;
    }
  }

  list(actor: ActorContext, input: LeadListInput) {
    return this.repository.listAuthorized(this.leadScope(actor, "leads.read"), input);
  }

  async get(actor: ActorContext, leadId: string) {
    const lead = await this.repository.findAuthorized(this.leadScope(actor, "leads.read", leadId), leadId);
    if (lead === null) throw this.notFound("Lead");
    return lead;
  }

  async getDiagnostic(actor: ActorContext, leadId: string) {
    const diagnostic = await this.repository.findDiagnosticAuthorized?.(
      this.leadScope(actor, "leads.read", leadId),
      leadId,
    ) ?? null;
    if (diagnostic === null) throw this.notFound("Lead diagnostic");
    return diagnostic;
  }

  async updateCommercial(
    actor: ActorContext,
    leadId: string,
    input: LeadCommercialPatch,
    audit: AuditContext,
  ) {
    const scope = this.leadScope(actor, "leads.manage", leadId);
    try {
      const lead = await this.repository.updateCommercial(scope, leadId, input, audit);
      if (lead === null) throw this.notFound("Lead");
      return lead;
    } catch (error) {
      if ((error as { readonly code?: string }).code === "ILVOX_SERVICE_NOT_FOUND") {
        throw this.notFound("Service");
      }
      throw error;
    }
  }

  async transition(
    actor: ActorContext,
    leadId: string,
    nextStatus: LeadStatus,
    reason: string | undefined,
    audit: AuditContext,
  ) {
    const scope = this.leadScope(actor, "leads.manage", leadId);
    const lead = await this.repository.findAuthorized(scope, leadId);
    if (lead === null) throw this.notFound("Lead");
    const transition = canTransitionLead({
      currentStatus: lead.status,
      nextStatus,
      actor,
      lead,
      ...(reason === undefined ? {} : { reason }),
    });
    if (!transition.allowed) {
      throw new AppError({
        code: ErrorCode.Conflict,
        message: "Lead transition is not allowed",
        statusCode: 409,
        details: { reason: transition.reasonCode, currentStatus: lead.status, nextStatus },
      });
    }
    const result = await this.repository.transition(
      scope,
      leadId,
      lead.status,
      nextStatus,
      reason?.trim(),
      audit,
    );
    if (result === null) throw this.notFound("Lead");
    if (result === "concurrent") throw this.concurrentConflict();
    return result;
  }

  async assign(
    actor: ActorContext,
    leadId: string,
    assignedToUserId: string,
    audit: AuditContext,
  ) {
    const result = await this.repository.assign(
      this.leadScope(actor, "leads.manage", leadId),
      leadId,
      assignedToUserId,
      audit,
    );
    if (result === null) throw this.notFound("Lead");
    if (result === "ineligible") {
      throw new AppError({
        code: ErrorCode.ValidationError,
        message: "Assignee is not an active internal user",
        statusCode: 400,
      });
    }
    return result;
  }

  async convert(
    actor: ActorContext,
    leadId: string,
    input: LeadConversionInput,
    audit: AuditContext,
  ) {
    if (input.mode === "create_organization" &&
        ((input.countryCode === undefined) !== (input.taxId === undefined))) {
      throw new AppError({
        code: ErrorCode.ValidationError,
        message: "countryCode and taxId must be provided together",
        statusCode: 400,
      });
    }
    const leadScope = this.leadScope(actor, "leads.manage", leadId);
    const organizationScope = input.mode === "standalone"
      ? undefined
      : this.authorization.assertAllowed({
          actor,
          action: "organizations.manage",
          ...(input.mode === "reuse_organization" ? { organizationId: input.organizationId } : {}),
          resourceType: "organization",
          ...(input.mode === "reuse_organization" ? { resourceId: input.organizationId } : {}),
        }).repositoryScope!;
    const result = await this.repository.convert(
      leadScope,
      organizationScope,
      leadId,
      input,
      audit,
    );
    if (result === null) throw this.notFound("Lead");
    if (result === "not_approved") {
      throw new AppError({
        code: ErrorCode.Conflict,
        message: "Only an approved lead can be converted",
        statusCode: 409,
      });
    }
    if (result === "organization_conflict") {
      throw new AppError({
        code: ErrorCode.Conflict,
        message: "Organization reuse or unique business identifier conflicts",
        statusCode: 409,
      });
    }
    if (result === "ineligible_manager") {
      throw new AppError({
        code: ErrorCode.ValidationError,
        message: "Account manager is not an active internal user",
        statusCode: 400,
      });
    }
    return result;
  }

  private leadScope(actor: ActorContext, action: "leads.read" | "leads.manage", leadId?: string): AuthorizedRepositoryScope {
    if (!actor.internal) {
      throw new AppError({
        code: ErrorCode.Forbidden,
        message: "Operation is not allowed",
        statusCode: 403,
      });
    }
    return this.authorization.assertAllowed({
      actor,
      action,
      resourceType: "lead",
      ...(leadId === undefined ? {} : { resourceId: leadId }),
    }).repositoryScope!;
  }

  private notFound(resource: string): AppError {
    return new AppError({
      code: ErrorCode.NotFound,
      message: `${resource} not found`,
      statusCode: 404,
    });
  }

  private concurrentConflict(): AppError {
    return new AppError({
      code: ErrorCode.Conflict,
      message: "Lead changed concurrently; reload and retry",
      statusCode: 409,
    });
  }
}
