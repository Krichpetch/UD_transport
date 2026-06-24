## Deferred Security Findings — Sprint [next]

### MEDIUM-1: pending-reviews exposes admin queue to all roles
File: apps/api/src/stations/stations.controller.ts
Route: GET /stations/pending-reviews  
Risk: All authenticated roles can see admin approval queue
Fix: Add @Roles('ADMIN') guard to this route
---

### MEDIUM-2: Checklist history leaks auditor usernames
File: apps/api/src/checklists/checklists.service.ts:16
Route: GET /stations/:stationId/checklist/history
Risk: Auditor names visible to EXECUTIVE and other AUDITORs
Fix: Strip auditor include for non-ADMIN callers
---

### MEDIUM-3: No explicit role guard on checklist read endpoints
File: apps/api/src/checklists/checklists.controller.ts:15,21
Risk: Implicit all-role access violates CLAUDE.md requirement
Fix: Add explicit allowed-roles check even if all 3 roles are permitted
---

### MEDIUM-4: AuthRequest.role typed as string not UserRole enum
File: apps/api/src/checklists/checklists.controller.ts:6
Also: stations.controller.ts:20, uploads.controller.ts:16
Risk: Typo in role check string compiles silently
Fix: Import and use Prisma UserRole enum for all role comparisons
---

### MEDIUM-5: Checklist items body has no DTO validation
File: apps/api/src/checklists/checklists.controller.ts:29
Risk: Arbitrary JSON accepted and persisted, no size limit, memory exhaustion possible
Fix: Create ChecklistItemsDto with class-validator, add ValidationPipe, add size limit
---

### MEDIUM-6: AuditLog for APPROVE_CHECKLIST missing stationId
File: apps/api/src/stations/stations.controller.ts:97
Risk: Audit trail cannot reconstruct which station was affected if checklist is deleted
Fix: Add stationId field to the AuditLog entry for APPROVE_CHECKLIST action
