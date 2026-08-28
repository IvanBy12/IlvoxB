import type { AuditContext } from "../../common/audit/audit.js";
import type { AuthorizedRepositoryScope } from "../../common/auth/authorization.types.js";
import type { PaginatedResult, PaginationInput } from "../../common/http/pagination.js";
import type { ProjectStatus } from "../../common/state-machines/project-transitions.js";

export const PROJECT_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type ProjectPriority = (typeof PROJECT_PRIORITIES)[number];
export const PROJECT_ROLE_CODES = ["project_lead", "project_member", "project_viewer"] as const;
export type ProjectRoleCode = (typeof PROJECT_ROLE_CODES)[number];
export const PROJECT_MEMBER_STATUSES = ["active", "revoked"] as const;
export type ProjectMemberStatus = (typeof PROJECT_MEMBER_STATUSES)[number];
export const MILESTONE_STATUSES = ["pending", "in_progress", "completed"] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];
export const DELIVERABLE_STATUSES = ["pending", "in_review", "delivered", "approved", "rejected"] as const;
export type DeliverableStatus = (typeof DELIVERABLE_STATUSES)[number];
export const DELIVERABLE_PARTIES = ["internal", "client"] as const;
export type DeliverableParty = (typeof DELIVERABLE_PARTIES)[number];

export interface ProjectRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly serviceId: string | null;
  readonly serviceName: string | null;
  readonly name: string;
  readonly description: string;
  readonly status: ProjectStatus;
  readonly priority: ProjectPriority;
  readonly leadUserId: string;
  readonly leadUserName: string | null;
  readonly startDate: string;
  readonly dueDate: string;
  readonly createdByUserId: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ProjectCreateInput {
  readonly organizationId: string;
  readonly serviceId?: string;
  readonly name: string;
  readonly description: string;
  readonly priority?: ProjectPriority;
  readonly leadUserId: string;
  readonly startDate: string;
  readonly dueDate: string;
}

export interface ProjectPatch {
  readonly serviceId?: string | null;
  readonly name?: string;
  readonly description?: string;
  readonly priority?: ProjectPriority;
  readonly startDate?: string;
  readonly dueDate?: string;
  readonly expectedUpdatedAt?: Date;
}

export interface ProjectListInput extends PaginationInput {
  readonly search?: string;
  readonly status?: ProjectStatus;
  readonly organizationId?: string;
  readonly leadUserId?: string;
  readonly startFrom?: string;
  readonly dueTo?: string;
  readonly sortBy: "createdAt" | "updatedAt" | "name" | "startDate" | "dueDate";
  readonly sortDirection: "asc" | "desc";
}

export interface ProjectMemberRecord {
  readonly projectId: string;
  readonly organizationId: string;
  readonly userId: string;
  readonly displayName: string | null;
  readonly roleCode: ProjectRoleCode;
  readonly assignedByUserId: string | null;
  readonly status: ProjectMemberStatus;
  readonly revokedAt: Date | null;
  readonly revokedByUserId: string | null;
  readonly joinedAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface MilestoneRecord {
  readonly id: string;
  readonly projectId: string;
  readonly organizationId: string;
  readonly name: string;
  readonly description: string | null;
  readonly status: MilestoneStatus;
  readonly dueDate: string;
  readonly completedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface MilestoneCreate {
  readonly name: string;
  readonly description?: string;
  readonly dueDate: string;
}

export interface MilestonePatch {
  readonly name?: string;
  readonly description?: string | null;
  readonly status?: MilestoneStatus;
  readonly dueDate?: string;
  readonly expectedUpdatedAt?: Date;
}

export interface DeliverableRecord {
  readonly id: string;
  readonly projectId: string;
  readonly organizationId: string;
  readonly milestoneId: string | null;
  readonly name: string;
  readonly description: string | null;
  readonly deliveryParty: DeliverableParty;
  readonly dueDate: string | null;
  readonly status: DeliverableStatus;
  readonly approvedByUserId: string | null;
  readonly approvedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface DeliverableCreate {
  readonly name: string;
  readonly description?: string;
  readonly milestoneId?: string;
  readonly deliveryParty?: DeliverableParty;
  readonly dueDate?: string;
}

export interface DeliverablePatch {
  readonly name?: string;
  readonly description?: string | null;
  readonly milestoneId?: string | null;
  readonly deliveryParty?: DeliverableParty;
  readonly dueDate?: string | null;
  readonly status?: DeliverableStatus;
  readonly expectedUpdatedAt?: Date;
}

export type ProjectWriteResult<T> =
  | T
  | "not_found"
  | "conflict"
  | "ineligible_user"
  | "invalid_service"
  | "invalid_dates";

export interface ProjectRepository {
  listAuthorized(
    scope: AuthorizedRepositoryScope,
    input: ProjectListInput,
  ): Promise<PaginatedResult<ProjectRecord>>;
  findAuthorized(scope: AuthorizedRepositoryScope, projectId: string): Promise<ProjectRecord | null>;
  getTransitionContext(
    scope: AuthorizedRepositoryScope,
    projectId: string,
  ): Promise<{
    readonly project: ProjectRecord;
    readonly incompleteMilestones: number;
    readonly unapprovedDeliverables: number;
  } | null>;
  create(
    scope: AuthorizedRepositoryScope,
    input: ProjectCreateInput,
    createdByUserId: string,
    audit: AuditContext,
  ): Promise<ProjectWriteResult<ProjectRecord>>;
  update(
    scope: AuthorizedRepositoryScope,
    projectId: string,
    input: ProjectPatch,
    audit: AuditContext,
  ): Promise<ProjectWriteResult<ProjectRecord>>;
  assignLead(
    scope: AuthorizedRepositoryScope,
    projectId: string,
    leadUserId: string,
    expectedUpdatedAt: Date | undefined,
    audit: AuditContext,
  ): Promise<ProjectWriteResult<ProjectRecord>>;
  transition(
    scope: AuthorizedRepositoryScope,
    projectId: string,
    currentStatus: ProjectStatus,
    nextStatus: ProjectStatus,
    reason: string | undefined,
    audit: AuditContext,
  ): Promise<ProjectWriteResult<ProjectRecord>>;
  listMembers(
    scope: AuthorizedRepositoryScope,
    projectId: string,
  ): Promise<readonly ProjectMemberRecord[] | null>;
  createMember(
    scope: AuthorizedRepositoryScope,
    projectId: string,
    userId: string,
    roleCode: ProjectRoleCode,
    audit: AuditContext,
  ): Promise<ProjectWriteResult<ProjectMemberRecord>>;
  updateMember(
    scope: AuthorizedRepositoryScope,
    projectId: string,
    userId: string,
    roleCode: ProjectRoleCode,
    expectedUpdatedAt: Date | undefined,
    audit: AuditContext,
  ): Promise<ProjectWriteResult<ProjectMemberRecord>>;
  revokeMember(
    scope: AuthorizedRepositoryScope,
    projectId: string,
    userId: string,
    expectedUpdatedAt: Date | undefined,
    revokedByUserId: string,
    audit: AuditContext,
  ): Promise<ProjectWriteResult<ProjectMemberRecord>>;
  listMilestones(
    scope: AuthorizedRepositoryScope,
    projectId: string,
  ): Promise<readonly MilestoneRecord[] | null>;
  findMilestone(
    scope: AuthorizedRepositoryScope,
    projectId: string,
    milestoneId: string,
  ): Promise<MilestoneRecord | null>;
  createMilestone(
    scope: AuthorizedRepositoryScope,
    projectId: string,
    input: MilestoneCreate,
    audit: AuditContext,
  ): Promise<ProjectWriteResult<MilestoneRecord>>;
  updateMilestone(
    scope: AuthorizedRepositoryScope,
    projectId: string,
    milestoneId: string,
    input: MilestonePatch,
    audit: AuditContext,
  ): Promise<ProjectWriteResult<MilestoneRecord>>;
  listDeliverables(
    scope: AuthorizedRepositoryScope,
    projectId: string,
  ): Promise<readonly DeliverableRecord[] | null>;
  findDeliverable(
    scope: AuthorizedRepositoryScope,
    projectId: string,
    deliverableId: string,
  ): Promise<DeliverableRecord | null>;
  createDeliverable(
    scope: AuthorizedRepositoryScope,
    projectId: string,
    input: DeliverableCreate,
    audit: AuditContext,
  ): Promise<ProjectWriteResult<DeliverableRecord>>;
  updateDeliverable(
    scope: AuthorizedRepositoryScope,
    projectId: string,
    deliverableId: string,
    input: DeliverablePatch,
    actorUserId: string,
    audit: AuditContext,
  ): Promise<ProjectWriteResult<DeliverableRecord>>;
}
