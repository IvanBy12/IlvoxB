-- ILVOX - Esquema PostgreSQL reconstruido
-- Compatible con PostgreSQL 16+.
-- 19 tablas del MVP.
-- No incluye DROP, triggers, procedimientos ni RLS.
-- Clerk autentica; PostgreSQL conserva usuarios locales, membresías y RBAC.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE app_users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    clerk_user_id varchar(255) NOT NULL UNIQUE,
    primary_email varchar(320) NOT NULL,
    first_name varchar(120),
    last_name varchar(120),
    avatar_url text,
    status varchar(20) NOT NULL DEFAULT 'pending',
    last_synced_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT chk_app_users_clerk_user_id_not_blank
        CHECK (btrim(clerk_user_id) <> ''),
    CONSTRAINT chk_app_users_primary_email_not_blank
        CHECK (btrim(primary_email) <> ''),
    CONSTRAINT chk_app_users_status
        CHECK (status IN ('pending', 'active', 'blocked', 'deleted'))
);

CREATE INDEX idx_app_users_primary_email_lower
    ON app_users (lower(primary_email));

CREATE INDEX idx_app_users_status
    ON app_users (status);


CREATE TABLE roles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scope varchar(20) NOT NULL,
    code varchar(64) NOT NULL,
    name varchar(120) NOT NULL,
    description text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT uq_roles_scope_code UNIQUE (scope, code),
    CONSTRAINT uq_roles_id_scope UNIQUE (id, scope),
    CONSTRAINT chk_roles_scope
        CHECK (scope IN ('global', 'organization', 'project')),
    CONSTRAINT chk_roles_code_not_blank
        CHECK (btrim(code) <> ''),
    CONSTRAINT chk_roles_name_not_blank
        CHECK (btrim(name) <> '')
);


CREATE TABLE permissions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code varchar(100) NOT NULL UNIQUE,
    module varchar(64) NOT NULL,
    name varchar(120) NOT NULL,
    description text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT chk_permissions_code_not_blank
        CHECK (btrim(code) <> ''),
    CONSTRAINT chk_permissions_module_not_blank
        CHECK (btrim(module) <> ''),
    CONSTRAINT chk_permissions_name_not_blank
        CHECK (btrim(name) <> '')
);


CREATE TABLE role_permissions (
    role_id uuid NOT NULL
        REFERENCES roles(id) ON DELETE CASCADE,
    permission_id uuid NOT NULL
        REFERENCES permissions(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (role_id, permission_id)
);

CREATE INDEX idx_role_permissions_permission_id
    ON role_permissions (permission_id);


CREATE TABLE user_roles (
    user_id uuid NOT NULL
        REFERENCES app_users(id) ON DELETE RESTRICT,
    role_id uuid NOT NULL,
    role_scope varchar(20) NOT NULL DEFAULT 'global',
    assigned_by_user_id uuid
        REFERENCES app_users(id) ON DELETE RESTRICT,
    assigned_at timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (user_id, role_id),

    CONSTRAINT fk_user_roles_global_role
        FOREIGN KEY (role_id, role_scope)
        REFERENCES roles(id, scope)
        ON DELETE RESTRICT,

    CONSTRAINT chk_user_roles_global_scope
        CHECK (role_scope = 'global')
);

CREATE INDEX idx_user_roles_role_scope
    ON user_roles (role_id, role_scope);

CREATE INDEX idx_user_roles_assigned_by
    ON user_roles (assigned_by_user_id);


CREATE TABLE identity_webhook_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    clerk_event_id varchar(255) NOT NULL UNIQUE,
    event_type varchar(120) NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'received',
    attempt_count integer NOT NULL DEFAULT 0,
    processed_at timestamptz,
    last_error_redacted text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT chk_identity_webhook_events_status
        CHECK (status IN ('received', 'processing', 'processed', 'failed')),
    CONSTRAINT chk_identity_webhook_events_attempt_count
        CHECK (attempt_count >= 0),
    CONSTRAINT chk_identity_webhook_events_processed_at
        CHECK (
            (status = 'processed' AND processed_at IS NOT NULL)
            OR
            (status <> 'processed' AND processed_at IS NULL)
        )
);

CREATE INDEX idx_identity_webhook_events_work_queue
    ON identity_webhook_events (status, created_at);


CREATE TABLE organizations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name varchar(160) NOT NULL,
    legal_name varchar(200),
    industry varchar(120),
    size varchar(20),
    status varchar(20) NOT NULL DEFAULT 'active',
    country_code char(2),
    tax_id varchar(64),
    tax_id_normalized varchar(64),
    account_manager_user_id uuid
        REFERENCES app_users(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT chk_organizations_name_not_blank
        CHECK (btrim(name) <> ''),
    CONSTRAINT chk_organizations_size
        CHECK (
            size IS NULL
            OR size IN ('micro', 'small', 'medium', 'large')
        ),
    CONSTRAINT chk_organizations_status
        CHECK (status IN ('active', 'inactive', 'archived')),
    CONSTRAINT chk_organizations_country_code
        CHECK (
            country_code IS NULL
            OR country_code ~ '^[A-Z]{2}$'
        ),
    CONSTRAINT chk_organizations_tax_fields
        CHECK (
            (tax_id IS NULL AND tax_id_normalized IS NULL)
            OR
            (
                tax_id IS NOT NULL
                AND tax_id_normalized IS NOT NULL
                AND country_code IS NOT NULL
                AND btrim(tax_id_normalized) <> ''
            )
        )
);

CREATE UNIQUE INDEX uq_organizations_country_tax_normalized
    ON organizations (country_code, tax_id_normalized)
    WHERE country_code IS NOT NULL
      AND tax_id_normalized IS NOT NULL;

CREATE INDEX idx_organizations_account_manager
    ON organizations (account_manager_user_id);

CREATE INDEX idx_organizations_status
    ON organizations (status);


CREATE TABLE organization_memberships (
    organization_id uuid NOT NULL
        REFERENCES organizations(id) ON DELETE RESTRICT,
    user_id uuid NOT NULL
        REFERENCES app_users(id) ON DELETE RESTRICT,
    role_id uuid NOT NULL,
    role_scope varchar(20) NOT NULL DEFAULT 'organization',
    status varchar(20) NOT NULL DEFAULT 'pending',
    job_title varchar(120),
    phone varchar(40),
    activated_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (organization_id, user_id),

    CONSTRAINT fk_organization_memberships_organization_role
        FOREIGN KEY (role_id, role_scope)
        REFERENCES roles(id, scope)
        ON DELETE RESTRICT,

    CONSTRAINT chk_organization_memberships_scope
        CHECK (role_scope = 'organization'),

    CONSTRAINT chk_organization_memberships_status
        CHECK (status IN ('pending', 'active', 'revoked')),

    CONSTRAINT chk_organization_memberships_timestamps
        CHECK (
            (
                status = 'active'
                AND activated_at IS NOT NULL
                AND revoked_at IS NULL
            )
            OR
            (
                status = 'pending'
                AND activated_at IS NULL
                AND revoked_at IS NULL
            )
            OR
            (
                status = 'revoked'
                AND revoked_at IS NOT NULL
            )
        )
);

CREATE INDEX idx_organization_memberships_user
    ON organization_memberships (user_id);

CREATE INDEX idx_organization_memberships_role_scope
    ON organization_memberships (role_id, role_scope);

CREATE INDEX idx_organization_memberships_access
    ON organization_memberships (organization_id, status);


CREATE TABLE services (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name varchar(160) NOT NULL UNIQUE,
    category varchar(40) NOT NULL,
    description text NOT NULL,
    is_public boolean NOT NULL DEFAULT true,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT chk_services_category
        CHECK (
            category IN (
                'development',
                'ecommerce',
                'digital_presence',
                'automation',
                'support'
            )
        )
);

CREATE INDEX idx_services_public_active
    ON services (is_public, is_active);


CREATE TABLE leads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name varchar(160) NOT NULL,
    company_name varchar(200),
    email varchar(320) NOT NULL,
    phone varchar(40),
    service_id uuid
        REFERENCES services(id) ON DELETE RESTRICT,
    message text NOT NULL,
    source varchar(30) NOT NULL,
    status varchar(30) NOT NULL DEFAULT 'new',
    assigned_to_user_id uuid
        REFERENCES app_users(id) ON DELETE RESTRICT,
    converted_organization_id uuid
        REFERENCES organizations(id) ON DELETE RESTRICT,
    converted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT chk_leads_source
        CHECK (
            source IN (
                'diagnostic',
                'quotation',
                'contact',
                'referral',
                'campaign'
            )
        ),

    CONSTRAINT chk_leads_status
        CHECK (
            status IN (
                'new',
                'contacted',
                'in_diagnostic',
                'quotation',
                'proposal_sent',
                'negotiation',
                'approved',
                'not_approved',
                'converted'
            )
        ),

    CONSTRAINT chk_leads_conversion
        CHECK (
            (
                status = 'converted'
                AND converted_organization_id IS NOT NULL
                AND converted_at IS NOT NULL
            )
            OR
            (
                status <> 'converted'
                AND converted_organization_id IS NULL
                AND converted_at IS NULL
            )
        )
);

CREATE INDEX idx_leads_status_created
    ON leads (status, created_at DESC);

CREATE INDEX idx_leads_service
    ON leads (service_id);

CREATE INDEX idx_leads_assigned_to
    ON leads (assigned_to_user_id);

CREATE INDEX idx_leads_converted_organization
    ON leads (converted_organization_id);

CREATE INDEX idx_leads_email_lower
    ON leads (lower(email));


CREATE TABLE projects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL
        REFERENCES organizations(id) ON DELETE RESTRICT,
    service_id uuid
        REFERENCES services(id) ON DELETE RESTRICT,
    name varchar(200) NOT NULL,
    description text NOT NULL,
    status varchar(30) NOT NULL DEFAULT 'planning',
    priority varchar(20) NOT NULL DEFAULT 'medium',
    lead_user_id uuid NOT NULL
        REFERENCES app_users(id) ON DELETE RESTRICT,
    start_date date NOT NULL,
    due_date date NOT NULL,
    created_by_user_id uuid NOT NULL
        REFERENCES app_users(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT uq_projects_id_organization UNIQUE (id, organization_id),

    CONSTRAINT chk_projects_status
        CHECK (
            status IN (
                'planning',
                'in_progress',
                'paused',
                'in_review',
                'delivered',
                'cancelled'
            )
        ),

    CONSTRAINT chk_projects_priority
        CHECK (priority IN ('low', 'medium', 'high', 'urgent')),

    CONSTRAINT chk_projects_dates
        CHECK (due_date >= start_date)
);

CREATE INDEX idx_projects_organization_status
    ON projects (organization_id, status);

CREATE INDEX idx_projects_service
    ON projects (service_id);

CREATE INDEX idx_projects_lead
    ON projects (lead_user_id);


CREATE TABLE project_members (
    project_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    user_id uuid NOT NULL
        REFERENCES app_users(id) ON DELETE RESTRICT,
    role_id uuid NOT NULL,
    role_scope varchar(20) NOT NULL DEFAULT 'project',
    assigned_by_user_id uuid
        REFERENCES app_users(id) ON DELETE RESTRICT,
    joined_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (project_id, user_id),

    CONSTRAINT fk_project_members_project
        FOREIGN KEY (project_id, organization_id)
        REFERENCES projects(id, organization_id)
        ON DELETE RESTRICT,

    CONSTRAINT fk_project_members_project_role
        FOREIGN KEY (role_id, role_scope)
        REFERENCES roles(id, scope)
        ON DELETE RESTRICT,

    CONSTRAINT chk_project_members_scope
        CHECK (role_scope = 'project')
);

CREATE INDEX idx_project_members_user
    ON project_members (user_id);

CREATE INDEX idx_project_members_role_scope
    ON project_members (role_id, role_scope);

CREATE INDEX idx_project_members_assigned_by
    ON project_members (assigned_by_user_id);


CREATE TABLE project_milestones (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    name varchar(200) NOT NULL,
    description text,
    status varchar(20) NOT NULL DEFAULT 'pending',
    due_date date NOT NULL,
    completed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT uq_project_milestones_id_organization
        UNIQUE (id, organization_id),

    CONSTRAINT fk_project_milestones_project
        FOREIGN KEY (project_id, organization_id)
        REFERENCES projects(id, organization_id)
        ON DELETE RESTRICT,

    CONSTRAINT chk_project_milestones_status
        CHECK (status IN ('pending', 'in_progress', 'completed')),

    CONSTRAINT chk_project_milestones_completed_at
        CHECK (
            (status = 'completed' AND completed_at IS NOT NULL)
            OR
            (status <> 'completed' AND completed_at IS NULL)
        )
);

CREATE INDEX idx_project_milestones_project_status
    ON project_milestones (project_id, status);

CREATE INDEX idx_project_milestones_due_date
    ON project_milestones (due_date);


CREATE TABLE deliverables (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    name varchar(200) NOT NULL,
    description text,
    status varchar(20) NOT NULL DEFAULT 'pending',
    approved_by_user_id uuid
        REFERENCES app_users(id) ON DELETE RESTRICT,
    approved_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT uq_deliverables_id_organization
        UNIQUE (id, organization_id),

    CONSTRAINT fk_deliverables_project
        FOREIGN KEY (project_id, organization_id)
        REFERENCES projects(id, organization_id)
        ON DELETE RESTRICT,

    CONSTRAINT chk_deliverables_status
        CHECK (
            status IN (
                'pending',
                'in_review',
                'delivered',
                'approved',
                'rejected'
            )
        ),

    CONSTRAINT chk_deliverables_approval
        CHECK (
            (
                status = 'approved'
                AND approved_by_user_id IS NOT NULL
                AND approved_at IS NOT NULL
            )
            OR
            (
                status <> 'approved'
                AND approved_by_user_id IS NULL
                AND approved_at IS NULL
            )
        )
);

CREATE INDEX idx_deliverables_project_status
    ON deliverables (project_id, status);

CREATE INDEX idx_deliverables_approved_by
    ON deliverables (approved_by_user_id);


CREATE TABLE tickets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL
        REFERENCES organizations(id) ON DELETE RESTRICT,
    project_id uuid,
    requester_user_id uuid NOT NULL
        REFERENCES app_users(id) ON DELETE RESTRICT,
    assigned_to_user_id uuid
        REFERENCES app_users(id) ON DELETE RESTRICT,

    ticket_number bigint GENERATED ALWAYS AS IDENTITY,

    ticket_year smallint NOT NULL
        DEFAULT (EXTRACT(YEAR FROM CURRENT_DATE)::smallint),

    code varchar(40) GENERATED ALWAYS AS (
        'TCK-'
        || ticket_year::text
        || '-'
        || repeat(
            '0',
            greatest(6 - length(ticket_number::text), 0)
        )
        || ticket_number::text
    ) STORED,

    type varchar(30) NOT NULL,
    requested_priority varchar(20) NOT NULL DEFAULT 'medium',
    priority varchar(20) NOT NULL DEFAULT 'medium',
    status varchar(30) NOT NULL DEFAULT 'new',
    subject varchar(240) NOT NULL,
    description text NOT NULL,
    resolution text,
    resolved_at timestamptz,
    closed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT uq_tickets_ticket_number UNIQUE (ticket_number),
    CONSTRAINT uq_tickets_code UNIQUE (code),
    CONSTRAINT uq_tickets_id_organization UNIQUE (id, organization_id),

    CONSTRAINT fk_tickets_project
        FOREIGN KEY (project_id, organization_id)
        REFERENCES projects(id, organization_id)
        ON DELETE RESTRICT,

    CONSTRAINT chk_tickets_ticket_year
        CHECK (ticket_year BETWEEN 2000 AND 9999),

    CONSTRAINT chk_tickets_type
        CHECK (
            type IN (
                'incident',
                'bug',
                'service_request',
                'improvement_request',
                'question',
                'change'
            )
        ),

    CONSTRAINT chk_tickets_requested_priority
        CHECK (
            requested_priority IN ('low', 'medium', 'high', 'urgent')
        ),

    CONSTRAINT chk_tickets_priority
        CHECK (priority IN ('low', 'medium', 'high', 'urgent')),

    CONSTRAINT chk_tickets_status
        CHECK (
            status IN (
                'new',
                'classifying',
                'assigned',
                'in_progress',
                'pending_client',
                'resolved',
                'closed',
                'reopened',
                'cancelled'
            )
        ),

    CONSTRAINT chk_tickets_resolution
        CHECK (
            status NOT IN ('resolved', 'closed')
            OR
            (
                resolution IS NOT NULL
                AND btrim(resolution) <> ''
                AND resolved_at IS NOT NULL
            )
        ),

    CONSTRAINT chk_tickets_closed_at
        CHECK (
            (status = 'closed' AND closed_at IS NOT NULL)
            OR
            (status <> 'closed' AND closed_at IS NULL)
        )
);

CREATE INDEX idx_tickets_organization_status
    ON tickets (organization_id, status);

CREATE INDEX idx_tickets_project
    ON tickets (project_id);

CREATE INDEX idx_tickets_requester
    ON tickets (requester_user_id);

CREATE INDEX idx_tickets_assignee_status
    ON tickets (assigned_to_user_id, status);

CREATE INDEX idx_tickets_created_at
    ON tickets (created_at DESC);


CREATE TABLE ticket_comments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    author_user_id uuid NOT NULL
        REFERENCES app_users(id) ON DELETE RESTRICT,
    visibility varchar(20) NOT NULL,
    content text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT uq_ticket_comments_id_organization
        UNIQUE (id, organization_id),

    CONSTRAINT fk_ticket_comments_ticket
        FOREIGN KEY (ticket_id, organization_id)
        REFERENCES tickets(id, organization_id)
        ON DELETE RESTRICT,

    CONSTRAINT chk_ticket_comments_visibility
        CHECK (visibility IN ('internal', 'client')),

    CONSTRAINT chk_ticket_comments_content
        CHECK (btrim(content) <> '')
);

CREATE INDEX idx_ticket_comments_ticket_created
    ON ticket_comments (ticket_id, created_at);

CREATE INDEX idx_ticket_comments_author
    ON ticket_comments (author_user_id);

CREATE INDEX idx_ticket_comments_client_visible
    ON ticket_comments (ticket_id, created_at)
    WHERE visibility = 'client';


CREATE TABLE tasks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid
        REFERENCES organizations(id) ON DELETE RESTRICT,
    project_id uuid,
    ticket_id uuid,
    title varchar(240) NOT NULL,
    description text NOT NULL,
    assigned_to_user_id uuid NOT NULL
        REFERENCES app_users(id) ON DELETE RESTRICT,
    created_by_user_id uuid NOT NULL
        REFERENCES app_users(id) ON DELETE RESTRICT,
    priority varchar(20) NOT NULL DEFAULT 'medium',
    status varchar(30) NOT NULL DEFAULT 'pending',
    due_date date NOT NULL,
    estimated_minutes integer,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT uq_tasks_id_organization
        UNIQUE (id, organization_id),

    CONSTRAINT fk_tasks_project
        FOREIGN KEY (project_id, organization_id)
        REFERENCES projects(id, organization_id)
        ON DELETE RESTRICT,

    CONSTRAINT fk_tasks_ticket
        FOREIGN KEY (ticket_id, organization_id)
        REFERENCES tickets(id, organization_id)
        ON DELETE RESTRICT,

    CONSTRAINT chk_tasks_priority
        CHECK (priority IN ('low', 'medium', 'high', 'urgent')),

    CONSTRAINT chk_tasks_status
        CHECK (
            status IN (
                'pending',
                'ready',
                'in_progress',
                'blocked',
                'in_review',
                'completed',
                'cancelled'
            )
        ),

    CONSTRAINT chk_tasks_estimated_minutes
        CHECK (
            estimated_minutes IS NULL
            OR estimated_minutes >= 0
        ),

    CONSTRAINT chk_tasks_single_context
        CHECK (num_nonnulls(project_id, ticket_id) <= 1),

    CONSTRAINT chk_tasks_context_organization
        CHECK (
            (
                project_id IS NULL
                AND ticket_id IS NULL
                AND organization_id IS NULL
            )
            OR
            (
                num_nonnulls(project_id, ticket_id) = 1
                AND organization_id IS NOT NULL
            )
        )
);

CREATE INDEX idx_tasks_organization_status
    ON tasks (organization_id, status);

CREATE INDEX idx_tasks_project
    ON tasks (project_id);

CREATE INDEX idx_tasks_ticket
    ON tasks (ticket_id);

CREATE INDEX idx_tasks_assignee_status
    ON tasks (assigned_to_user_id, status);

CREATE INDEX idx_tasks_due_date
    ON tasks (due_date);


CREATE TABLE files (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL
        REFERENCES organizations(id) ON DELETE RESTRICT,
    project_id uuid,
    ticket_id uuid,
    ticket_comment_id uuid,
    task_id uuid,
    deliverable_id uuid,
    uploaded_by_user_id uuid NOT NULL
        REFERENCES app_users(id) ON DELETE RESTRICT,
    original_name varchar(255) NOT NULL,
    storage_provider varchar(40) NOT NULL,
    object_key varchar(1024) NOT NULL,
    mime_type varchar(255) NOT NULL,
    size_bytes bigint NOT NULL,
    checksum_sha256 char(64),
    classification varchar(20) NOT NULL DEFAULT 'confidential',
    status varchar(20) NOT NULL DEFAULT 'pending_scan',
    created_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,

    CONSTRAINT uq_files_provider_object_key
        UNIQUE (storage_provider, object_key),

    CONSTRAINT fk_files_project
        FOREIGN KEY (project_id, organization_id)
        REFERENCES projects(id, organization_id)
        ON DELETE RESTRICT,

    CONSTRAINT fk_files_ticket
        FOREIGN KEY (ticket_id, organization_id)
        REFERENCES tickets(id, organization_id)
        ON DELETE RESTRICT,

    CONSTRAINT fk_files_ticket_comment
        FOREIGN KEY (ticket_comment_id, organization_id)
        REFERENCES ticket_comments(id, organization_id)
        ON DELETE RESTRICT,

    CONSTRAINT fk_files_task
        FOREIGN KEY (task_id, organization_id)
        REFERENCES tasks(id, organization_id)
        ON DELETE RESTRICT,

    CONSTRAINT fk_files_deliverable
        FOREIGN KEY (deliverable_id, organization_id)
        REFERENCES deliverables(id, organization_id)
        ON DELETE RESTRICT,

    CONSTRAINT chk_files_object_key_not_blank
        CHECK (btrim(object_key) <> ''),

    CONSTRAINT chk_files_size_bytes
        CHECK (size_bytes > 0),

    CONSTRAINT chk_files_checksum_sha256
        CHECK (
            checksum_sha256 IS NULL
            OR checksum_sha256 ~ '^[0-9A-Fa-f]{64}$'
        ),

    CONSTRAINT chk_files_classification
        CHECK (classification IN ('internal', 'confidential')),

    CONSTRAINT chk_files_status
        CHECK (
            status IN (
                'pending_upload',
                'pending_scan',
                'active',
                'quarantined',
                'deleted'
            )
        ),

    CONSTRAINT chk_files_single_parent
        CHECK (
            num_nonnulls(
                project_id,
                ticket_id,
                ticket_comment_id,
                task_id,
                deliverable_id
            ) = 1
        )
);

CREATE INDEX idx_files_organization_active
    ON files (organization_id, created_at DESC)
    WHERE status = 'active'
      AND deleted_at IS NULL;

CREATE INDEX idx_files_project
    ON files (project_id)
    WHERE project_id IS NOT NULL;

CREATE INDEX idx_files_ticket
    ON files (ticket_id)
    WHERE ticket_id IS NOT NULL;

CREATE INDEX idx_files_ticket_comment
    ON files (ticket_comment_id)
    WHERE ticket_comment_id IS NOT NULL;

CREATE INDEX idx_files_task
    ON files (task_id)
    WHERE task_id IS NOT NULL;

CREATE INDEX idx_files_deliverable
    ON files (deliverable_id)
    WHERE deliverable_id IS NOT NULL;

CREATE INDEX idx_files_uploaded_by
    ON files (uploaded_by_user_id);


CREATE TABLE audit_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id uuid
        REFERENCES app_users(id) ON DELETE RESTRICT,
    organization_id uuid
        REFERENCES organizations(id) ON DELETE RESTRICT,
    action varchar(120) NOT NULL,
    entity_type varchar(80) NOT NULL,
    entity_id uuid,
    old_values jsonb,
    new_values jsonb,
    ip_address inet,
    user_agent text,
    request_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT chk_audit_events_old_values_object
        CHECK (
            old_values IS NULL
            OR jsonb_typeof(old_values) = 'object'
        ),

    CONSTRAINT chk_audit_events_new_values_object
        CHECK (
            new_values IS NULL
            OR jsonb_typeof(new_values) = 'object'
        )
);

CREATE INDEX idx_audit_events_actor_created
    ON audit_events (actor_user_id, created_at DESC);

CREATE INDEX idx_audit_events_organization_created
    ON audit_events (organization_id, created_at DESC);

CREATE INDEX idx_audit_events_entity
    ON audit_events (entity_type, entity_id, created_at DESC);

CREATE INDEX idx_audit_events_request
    ON audit_events (request_id)
    WHERE request_id IS NOT NULL;

CREATE INDEX idx_audit_events_created
    ON audit_events (created_at DESC);

COMMIT;

-- ILVOX - Semilla RBAC reconstruida
-- 11 roles y 23 permisos.
-- IMPORTANTE:
-- El resumen de la conversación perdida mencionó 125 asignaciones.
-- La última matriz completa que sí quedó disponible contiene 142 asignaciones.
-- Este archivo usa exclusivamente esa matriz preservada; revise con Codex antes
-- de promoverla a producción si necesita reproducir exactamente las 125 filas.

BEGIN;

INSERT INTO roles (scope, code, name, description)
VALUES
    ('global', 'super_admin', 'Superadministrador', 'Control completo de administración, seguridad y auditoría.'),
    ('global', 'admin', 'Administrador', 'Administración operativa general del sistema.'),
    ('global', 'sales', 'Comercial', 'Gestión de prospectos, clientes y contexto comercial.'),
    ('global', 'support_agent', 'Agente de soporte', 'Clasificación, atención, resolución y cierre de tickets.'),
    ('global', 'project_lead', 'Líder global de proyectos', 'Gestión transversal de proyectos, tareas y equipos.'),
    ('global', 'contributor', 'Colaborador', 'Participación operativa en proyectos, tareas y tickets.'),
    ('organization', 'client_manager', 'Responsable del cliente', 'Acceso a proyectos, tickets y documentos de su organización.'),
    ('organization', 'client_contact', 'Contacto del cliente', 'Acceso operativo limitado a su organización.'),
    ('project', 'project_lead', 'Líder de proyecto', 'Gestión del proyecto concreto y sus recursos.'),
    ('project', 'project_member', 'Miembro de proyecto', 'Trabajo operativo dentro del proyecto asignado.'),
    ('project', 'project_viewer', 'Observador de proyecto', 'Consulta de información del proyecto sin mutaciones.')
ON CONFLICT (scope, code) DO UPDATE
SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    updated_at = now();

INSERT INTO permissions (code, module, name, description)
VALUES
    ('organizations.read', 'organizations', 'Consultar organizaciones', 'Consultar organizaciones autorizadas.'),
    ('organizations.manage', 'organizations', 'Gestionar organizaciones', 'Crear o modificar organizaciones.'),
    ('leads.read', 'leads', 'Consultar prospectos', 'Consultar prospectos autorizados.'),
    ('leads.manage', 'leads', 'Gestionar prospectos', 'Crear, asignar, actualizar y convertir prospectos.'),
    ('services.read', 'services', 'Consultar servicios', 'Consultar el catálogo de servicios.'),
    ('projects.read', 'projects', 'Consultar proyectos', 'Consultar proyectos autorizados.'),
    ('projects.manage', 'projects', 'Gestionar proyectos', 'Crear y modificar proyectos, hitos y entregables.'),
    ('tasks.read', 'tasks', 'Consultar tareas', 'Consultar tareas autorizadas.'),
    ('tasks.manage', 'tasks', 'Gestionar tareas', 'Crear, asignar y modificar tareas.'),
    ('tickets.read', 'tickets', 'Consultar tickets', 'Consultar tickets y comentarios visibles.'),
    ('tickets.create', 'tickets', 'Crear tickets', 'Crear tickets en contextos autorizados.'),
    ('tickets.assign', 'tickets', 'Asignar tickets', 'Asignar responsables de tickets.'),
    ('tickets.change_status', 'tickets', 'Cambiar estado de tickets', 'Ejecutar transiciones de estado permitidas.'),
    ('tickets.resolve', 'tickets', 'Resolver tickets', 'Registrar la resolución de un ticket.'),
    ('tickets.close', 'tickets', 'Cerrar tickets', 'Cerrar un ticket resuelto.'),
    ('ticket_comments.read_internal', 'ticket_comments', 'Leer comentarios internos', 'Consultar comentarios internos.'),
    ('ticket_comments.create_client', 'ticket_comments', 'Comentar para cliente', 'Crear comentarios visibles para el cliente.'),
    ('ticket_comments.create_internal', 'ticket_comments', 'Crear comentario interno', 'Crear comentarios internos.'),
    ('files.read', 'files', 'Consultar archivos', 'Consultar o descargar archivos autorizados.'),
    ('files.upload', 'files', 'Cargar archivos', 'Cargar archivos en contextos autorizados.'),
    ('users.manage', 'users', 'Gestionar usuarios', 'Gestionar usuarios, estados y asignaciones.'),
    ('roles.manage', 'roles', 'Gestionar asignaciones de roles', 'Asignar roles sembrados sin personalizarlos desde la interfaz.'),
    ('audit.read', 'audit', 'Consultar auditoría', 'Consultar eventos de auditoría.')
ON CONFLICT (code) DO UPDATE
SET
    module = EXCLUDED.module,
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    updated_at = now();

WITH permission_role_map (role_scope, role_code, permission_code) AS (
    VALUES
        ('global', 'super_admin', 'organizations.read'),
        ('global', 'admin', 'organizations.read'),
        ('global', 'sales', 'organizations.read'),
        ('global', 'support_agent', 'organizations.read'),
        ('global', 'project_lead', 'organizations.read'),
        ('global', 'contributor', 'organizations.read'),
        ('organization', 'client_manager', 'organizations.read'),
        ('organization', 'client_contact', 'organizations.read'),
        ('global', 'super_admin', 'organizations.manage'),
        ('global', 'admin', 'organizations.manage'),
        ('global', 'sales', 'organizations.manage'),
        ('global', 'super_admin', 'leads.read'),
        ('global', 'admin', 'leads.read'),
        ('global', 'sales', 'leads.read'),
        ('global', 'super_admin', 'leads.manage'),
        ('global', 'admin', 'leads.manage'),
        ('global', 'sales', 'leads.manage'),
        ('global', 'super_admin', 'services.read'),
        ('global', 'admin', 'services.read'),
        ('global', 'sales', 'services.read'),
        ('global', 'support_agent', 'services.read'),
        ('global', 'project_lead', 'services.read'),
        ('global', 'contributor', 'services.read'),
        ('global', 'super_admin', 'projects.read'),
        ('global', 'admin', 'projects.read'),
        ('global', 'sales', 'projects.read'),
        ('global', 'project_lead', 'projects.read'),
        ('global', 'contributor', 'projects.read'),
        ('organization', 'client_manager', 'projects.read'),
        ('organization', 'client_contact', 'projects.read'),
        ('project', 'project_lead', 'projects.read'),
        ('project', 'project_member', 'projects.read'),
        ('project', 'project_viewer', 'projects.read'),
        ('global', 'super_admin', 'projects.manage'),
        ('global', 'admin', 'projects.manage'),
        ('global', 'project_lead', 'projects.manage'),
        ('project', 'project_lead', 'projects.manage'),
        ('global', 'super_admin', 'tasks.read'),
        ('global', 'admin', 'tasks.read'),
        ('global', 'project_lead', 'tasks.read'),
        ('global', 'contributor', 'tasks.read'),
        ('project', 'project_lead', 'tasks.read'),
        ('project', 'project_member', 'tasks.read'),
        ('project', 'project_viewer', 'tasks.read'),
        ('global', 'super_admin', 'tasks.manage'),
        ('global', 'admin', 'tasks.manage'),
        ('global', 'project_lead', 'tasks.manage'),
        ('global', 'contributor', 'tasks.manage'),
        ('project', 'project_lead', 'tasks.manage'),
        ('project', 'project_member', 'tasks.manage'),
        ('global', 'super_admin', 'tickets.read'),
        ('global', 'admin', 'tickets.read'),
        ('global', 'sales', 'tickets.read'),
        ('global', 'support_agent', 'tickets.read'),
        ('global', 'project_lead', 'tickets.read'),
        ('global', 'contributor', 'tickets.read'),
        ('organization', 'client_manager', 'tickets.read'),
        ('organization', 'client_contact', 'tickets.read'),
        ('project', 'project_lead', 'tickets.read'),
        ('project', 'project_member', 'tickets.read'),
        ('project', 'project_viewer', 'tickets.read'),
        ('global', 'super_admin', 'tickets.create'),
        ('global', 'admin', 'tickets.create'),
        ('global', 'sales', 'tickets.create'),
        ('global', 'support_agent', 'tickets.create'),
        ('global', 'project_lead', 'tickets.create'),
        ('global', 'contributor', 'tickets.create'),
        ('organization', 'client_manager', 'tickets.create'),
        ('organization', 'client_contact', 'tickets.create'),
        ('project', 'project_lead', 'tickets.create'),
        ('project', 'project_member', 'tickets.create'),
        ('global', 'super_admin', 'tickets.assign'),
        ('global', 'admin', 'tickets.assign'),
        ('global', 'support_agent', 'tickets.assign'),
        ('global', 'project_lead', 'tickets.assign'),
        ('project', 'project_lead', 'tickets.assign'),
        ('global', 'super_admin', 'tickets.change_status'),
        ('global', 'admin', 'tickets.change_status'),
        ('global', 'support_agent', 'tickets.change_status'),
        ('global', 'project_lead', 'tickets.change_status'),
        ('organization', 'client_manager', 'tickets.change_status'),
        ('organization', 'client_contact', 'tickets.change_status'),
        ('project', 'project_lead', 'tickets.change_status'),
        ('global', 'super_admin', 'tickets.resolve'),
        ('global', 'admin', 'tickets.resolve'),
        ('global', 'support_agent', 'tickets.resolve'),
        ('global', 'project_lead', 'tickets.resolve'),
        ('project', 'project_lead', 'tickets.resolve'),
        ('global', 'super_admin', 'tickets.close'),
        ('global', 'admin', 'tickets.close'),
        ('global', 'support_agent', 'tickets.close'),
        ('organization', 'client_manager', 'tickets.close'),
        ('organization', 'client_contact', 'tickets.close'),
        ('global', 'super_admin', 'ticket_comments.read_internal'),
        ('global', 'admin', 'ticket_comments.read_internal'),
        ('global', 'support_agent', 'ticket_comments.read_internal'),
        ('global', 'project_lead', 'ticket_comments.read_internal'),
        ('global', 'contributor', 'ticket_comments.read_internal'),
        ('project', 'project_lead', 'ticket_comments.read_internal'),
        ('project', 'project_member', 'ticket_comments.read_internal'),
        ('global', 'super_admin', 'ticket_comments.create_client'),
        ('global', 'admin', 'ticket_comments.create_client'),
        ('global', 'support_agent', 'ticket_comments.create_client'),
        ('global', 'project_lead', 'ticket_comments.create_client'),
        ('global', 'contributor', 'ticket_comments.create_client'),
        ('organization', 'client_manager', 'ticket_comments.create_client'),
        ('organization', 'client_contact', 'ticket_comments.create_client'),
        ('project', 'project_lead', 'ticket_comments.create_client'),
        ('project', 'project_member', 'ticket_comments.create_client'),
        ('global', 'super_admin', 'ticket_comments.create_internal'),
        ('global', 'admin', 'ticket_comments.create_internal'),
        ('global', 'support_agent', 'ticket_comments.create_internal'),
        ('global', 'project_lead', 'ticket_comments.create_internal'),
        ('global', 'contributor', 'ticket_comments.create_internal'),
        ('project', 'project_lead', 'ticket_comments.create_internal'),
        ('project', 'project_member', 'ticket_comments.create_internal'),
        ('global', 'super_admin', 'files.read'),
        ('global', 'admin', 'files.read'),
        ('global', 'sales', 'files.read'),
        ('global', 'support_agent', 'files.read'),
        ('global', 'project_lead', 'files.read'),
        ('global', 'contributor', 'files.read'),
        ('organization', 'client_manager', 'files.read'),
        ('organization', 'client_contact', 'files.read'),
        ('project', 'project_lead', 'files.read'),
        ('project', 'project_member', 'files.read'),
        ('project', 'project_viewer', 'files.read'),
        ('global', 'super_admin', 'files.upload'),
        ('global', 'admin', 'files.upload'),
        ('global', 'support_agent', 'files.upload'),
        ('global', 'project_lead', 'files.upload'),
        ('global', 'contributor', 'files.upload'),
        ('organization', 'client_manager', 'files.upload'),
        ('organization', 'client_contact', 'files.upload'),
        ('project', 'project_lead', 'files.upload'),
        ('project', 'project_member', 'files.upload'),
        ('global', 'super_admin', 'users.manage'),
        ('global', 'admin', 'users.manage'),
        ('global', 'super_admin', 'roles.manage'),
        ('global', 'admin', 'roles.manage'),
        ('global', 'super_admin', 'audit.read'),
        ('global', 'admin', 'audit.read')
)
INSERT INTO role_permissions (role_id, permission_id)
SELECT
    r.id,
    p.id
FROM permission_role_map AS m
JOIN roles AS r
    ON r.scope = m.role_scope
   AND r.code = m.role_code
JOIN permissions AS p
    ON p.code = m.permission_code
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;

-- Verificación informativa:
SELECT 'roles' AS entity, count(*) AS total FROM roles
UNION ALL
SELECT 'permissions', count(*) FROM permissions
UNION ALL
SELECT 'role_permissions', count(*) FROM role_permissions;
