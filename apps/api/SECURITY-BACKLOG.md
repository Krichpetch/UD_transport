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
