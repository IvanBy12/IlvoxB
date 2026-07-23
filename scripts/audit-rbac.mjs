import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import "dotenv/config";

const sqlPath = process.argv[2];

if (!sqlPath) {
  console.error("Usage: node scripts/audit-rbac.mjs <sql-file> [--matrix]");
  process.exitCode = 2;
} else {
  const sql = await readFile(resolve(sqlPath), "utf8");

  const section = (start, end) => {
    const startAt = sql.indexOf(start);
    const endAt = sql.indexOf(end, startAt + start.length);
    if (startAt < 0 || endAt < 0) {
      throw new Error(`Could not locate SQL section: ${start}`);
    }
    return sql.slice(startAt, endAt);
  };

  const tuples = (valueSection, expectedSize) => {
    const rows = [];
    const tuplePattern = /\(([^()\r\n]+)\)/g;
    for (const match of valueSection.matchAll(tuplePattern)) {
      const values = [...match[1].matchAll(/'((?:[^']|'')*)'/g)].map((item) =>
        item[1].replaceAll("''", "'"),
      );
      if (values.length === expectedSize) rows.push(values);
    }
    return rows;
  };

  const roleRows = tuples(
    section("INSERT INTO roles (scope, code, name, description)", "ON CONFLICT (scope, code)"),
    4,
  );
  const permissionRows = tuples(
    section(
      "INSERT INTO permissions (code, module, name, description)",
      "ON CONFLICT (code)",
    ),
    4,
  );
  const associationRows = tuples(
    section(
      "WITH permission_role_map (role_scope, role_code, permission_code) AS (",
      "INSERT INTO role_permissions (role_id, permission_id)",
    ),
    3,
  );

  const roles = roleRows.map(([scope, code, name, description]) => ({
    scope,
    code,
    name,
    description,
  }));
  const permissions = permissionRows.map(([code, module, name, description]) => ({
    code,
    module,
    name,
    description,
  }));
  const associations = associationRows.map(([roleScope, roleCode, permissionCode]) => ({
    roleScope,
    roleCode,
    permissionCode,
  }));

  const roleKeys = new Set(roles.map((role) => `${role.scope}:${role.code}`));
  const permissionCodes = new Set(permissions.map((permission) => permission.code));
  const associationKey = (row) =>
    `${row.roleScope}:${row.roleCode}:${row.permissionCode}`;
  const groupedAssociations = Map.groupBy(associations, associationKey);
  const duplicates = [...groupedAssociations.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([key, rows]) => ({ key, count: rows.length }));
  const unknownRoles = associations.filter(
    (row) => !roleKeys.has(`${row.roleScope}:${row.roleCode}`),
  );
  const unknownPermissions = associations.filter(
    (row) => !permissionCodes.has(row.permissionCode),
  );
  const assignedRoleKeys = new Set(
    associations.map((row) => `${row.roleScope}:${row.roleCode}`),
  );
  const assignedPermissionCodes = new Set(
    associations.map((row) => row.permissionCode),
  );
  const rolesWithoutPermissions = roles.filter(
    (role) => !assignedRoleKeys.has(`${role.scope}:${role.code}`),
  );
  const permissionsWithoutRoles = permissions.filter(
    (permission) => !assignedPermissionCodes.has(permission.code),
  );
  const assignmentsByRole = Object.fromEntries(
    roles.map((role) => [
      `${role.scope}:${role.code}`,
      associations.filter(
        (row) => row.roleScope === role.scope && row.roleCode === role.code,
      ).length,
    ]),
  );
  const assignmentsByPermission = Object.fromEntries(
    permissions.map((permission) => [
      permission.code,
      associations.filter((row) => row.permissionCode === permission.code).length,
    ]),
  );
  const permissionSetByRole = Object.fromEntries(
    roles.map((role) => [
      `${role.scope}:${role.code}`,
      associations
        .filter(
          (row) => row.roleScope === role.scope && row.roleCode === role.code,
        )
        .map((row) => row.permissionCode)
        .sort(),
    ]),
  );
  const equivalentRoleSets = [];
  const roleEntries = Object.entries(permissionSetByRole);
  for (let leftIndex = 0; leftIndex < roleEntries.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < roleEntries.length; rightIndex += 1) {
      const [leftRole, leftPermissions] = roleEntries[leftIndex];
      const [rightRole, rightPermissions] = roleEntries[rightIndex];
      if (JSON.stringify(leftPermissions) === JSON.stringify(rightPermissions)) {
        equivalentRoleSets.push([leftRole, rightRole]);
      }
    }
  }

  const summary = {
    roles: roles.length,
    permissions: permissions.length,
    associations: associations.length,
    distinctAssociations: groupedAssociations.size,
    duplicates,
    unknownRoles,
    unknownPermissions,
    rolesWithoutPermissions,
    permissionsWithoutRoles,
    assignmentsByRole,
    assignmentsByPermission,
    equivalentRoleSets,
    historicalDifference: associations.length - 125,
  };

  const riskFor = (row) => {
    if (row.permissionCode === "roles.manage") {
      return ["Crítico", "Impedir que admin se eleve a super_admin y proteger el último superadmin."];
    }
    if (row.permissionCode === "users.manage") {
      return ["Alto", "Aplicar jerarquía: no bloquear ni modificar actores de mayor privilegio."];
    }
    if (
      row.roleScope === "organization" &&
      ["tickets.change_status", "tickets.close"].includes(row.permissionCode)
    ) {
      return [
        "Alto",
        "Sustituir por confirm/reject contextual o limitar a transiciones de cliente y tickets autorizados.",
      ];
    }
    if (
      row.roleScope === "global" &&
      ["organizations.manage", "projects.manage", "tasks.manage"].includes(row.permissionCode)
    ) {
      return ["Medio", "Mantener solo si el rol necesita alcance transversal; auditar toda mutación."];
    }
    if (
      row.roleScope === "global" &&
      ["organizations.read", "projects.read", "tickets.read", "files.read"].includes(
        row.permissionCode,
      )
    ) {
      return ["Medio", "Combinar permiso con filtros de alcance; nunca autorizar solo por código."];
    }
    if (row.permissionCode === "ticket_comments.read_internal") {
      return ["Medio", "Comprobar alcance de ticket/proyecto antes de devolver comentarios internos."];
    }
    if (row.permissionCode.startsWith("files.")) {
      return ["Medio", "Revalidar organización, padre, estado y visibilidad en cada operación."];
    }
    return ["Bajo", "Conservar con validación de alcance y pruebas negativas."];
  };

  if (process.argv.includes("--matrix")) {
    console.log("| Rol | Permiso | Alcance esperado | Riesgo | Recomendación |");
    console.log("| --- | --- | --- | --- | --- |");
    for (const row of associations) {
      const [risk, recommendation] = riskFor(row);
      console.log(
        `| \`${row.roleCode}\` | \`${row.permissionCode}\` | ${row.roleScope} | ${risk} | ${recommendation} |`,
      );
    }
  } else {
    const connectionString = process.env.DATABASE_URL;
    if (connectionString === undefined || connectionString.trim() === "") {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      const client = new pg.Client({ connectionString });
      let currentDatabase;
      try {
        await client.connect();
        await client.query("BEGIN READ ONLY");
        currentDatabase = (await client.query(`
          SELECT
            (SELECT count(*)::integer FROM roles) AS roles,
            (SELECT count(*)::integer FROM permissions) AS permissions,
            (SELECT count(*)::integer FROM role_permissions) AS associations,
            (SELECT count(*)::integer FROM (
              SELECT DISTINCT role_id, permission_id FROM role_permissions
            ) d) AS distinct_associations,
            (SELECT count(*)::integer FROM (
              SELECT role_id, permission_id FROM role_permissions
              GROUP BY role_id, permission_id HAVING count(*) > 1
            ) d) AS duplicate_associations,
            (SELECT count(*)::integer FROM role_permissions rp
             LEFT JOIN roles r ON r.id=rp.role_id
             LEFT JOIN permissions p ON p.id=rp.permission_id
             WHERE r.id IS NULL OR p.id IS NULL) AS orphan_associations,
            (SELECT count(*)::integer FROM role_permissions rp
             JOIN roles r ON r.id=rp.role_id JOIN permissions p ON p.id=rp.permission_id
             WHERE p.code='services.manage' AND r.scope='global'
               AND r.code IN ('super_admin','admin')) AS services_manage_targets,
            (SELECT count(*)::integer FROM role_permissions rp
             JOIN roles r ON r.id=rp.role_id JOIN permissions p ON p.id=rp.permission_id
             WHERE p.code='services.manage'
               AND NOT (r.scope='global' AND r.code IN ('super_admin','admin')))
               AS services_manage_leaks,
            (SELECT count(*)::integer FROM role_permissions rp
             JOIN roles r ON r.id=rp.role_id JOIN permissions p ON p.id=rp.permission_id
             WHERE p.code IN (
               'permissions.manage','roles.assign_super_admin','security.manage',
               'system.configure','organizations.access_all'
             ) AND r.scope='global' AND r.code='super_admin') AS sensitive_targets,
            (SELECT count(*)::integer FROM role_permissions rp
             JOIN roles r ON r.id=rp.role_id JOIN permissions p ON p.id=rp.permission_id
             WHERE p.code IN (
               'permissions.manage','roles.assign_super_admin','security.manage',
               'system.configure','organizations.access_all'
             ) AND NOT (r.scope='global' AND r.code='super_admin')) AS sensitive_leaks
        `)).rows[0];
        await client.query("ROLLBACK");
      } finally {
        await client.end().catch(() => undefined);
      }
      const currentOk =
        currentDatabase.roles === 11 &&
        currentDatabase.permissions === 37 &&
        currentDatabase.associations === 159 &&
        currentDatabase.distinct_associations === 159 &&
        currentDatabase.duplicate_associations === 0 &&
        currentDatabase.orphan_associations === 0 &&
        currentDatabase.services_manage_targets === 2 &&
        currentDatabase.services_manage_leaks === 0 &&
        currentDatabase.sensitive_targets === 5 &&
        currentDatabase.sensitive_leaks === 0;
      console.log(JSON.stringify({
        sourceBaseline: summary,
        currentDatabase,
        currentOk,
      }, null, 2));
      if (!currentOk) process.exitCode = 1;
    }
  }
}
