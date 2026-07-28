# Comentarios de tickets de Fase 6

Los endpoints implementados son:

- `GET /api/v1/tickets/:ticketId/comments`;
- `POST /api/v1/tickets/:ticketId/comments`.

El ticket padre debe pasar scope SQL. Autor, ticket y organización son
server-owned. El contenido es texto plano de 1 a 10.000 caracteres. No se
incluye en auditoría.

El esquema existente sí contiene visibilidad `internal|client`. Sin
`ticket_comments.read_internal` solo se devuelven comentarios `client`. Un
actor con permiso interno puede elegir visibilidad; los demás quedan forzados
a `client`.

Los comentarios son inmutables en esta fase. No se implementó edición ni
borrado físico porque el modelo no conserva revisiones ni posee borrado lógico.
No se incluyen archivos.
