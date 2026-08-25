export * from "./audit.js";
export * from "./files.js";
export * from "./identity.js";
export * from "./invitations.js";
export * from "./leads.js";
export * from "./organizations.js";
export * from "./projects.js";
export * from "./rbac.js";
export * from "./services.js";
export * from "./service-needs.js";
export * from "./tasks.js";
export * from "./tickets.js";

import { auditEvents } from "./audit.js";
import { files } from "./files.js";
import { appUsers, identityWebhookEvents } from "./identity.js";
import { organizationInvitations } from "./invitations.js";
import { leads } from "./leads.js";
import { organizationMemberships, organizations } from "./organizations.js";
import { deliverables, projectMembers, projectMilestones, projects } from "./projects.js";
import { permissions, rolePermissions, roles, userRoles } from "./rbac.js";
import { services } from "./services.js";
import { serviceNeedLinks, serviceNeeds } from "./service-needs.js";
import { tasks } from "./tasks.js";
import { ticketComments, tickets } from "./tickets.js";

export const schemaTables = [
  appUsers,
  identityWebhookEvents,
  roles,
  permissions,
  rolePermissions,
  userRoles,
  organizations,
  organizationMemberships,
  organizationInvitations,
  services,
  serviceNeeds,
  serviceNeedLinks,
  leads,
  projects,
  projectMembers,
  projectMilestones,
  deliverables,
  tickets,
  ticketComments,
  tasks,
  files,
  auditEvents,
] as const;
