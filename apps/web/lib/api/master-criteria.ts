// Session S5, Part C — detach/(re)attach a node from an explicit master link. Lives on the
// template's own per-node endpoints (see lib/api/templates.ts's base path), not a dedicated
// master-criteria resource.
//
// Session S5-fix, Part A — the standalone browse/edit page (and its list/get/create/update calls)
// is gone; the backend endpoints it used still exist (master-criteria.controller.ts, kept per Part
// A), but nothing in the frontend calls them anymore now that masters are created/edited
// transparently from the facility-grouped editor. Only what MasterAttachedBanner.tsx still needs —
// detach and re-attach — remains here.
import { api } from '@/lib/api'

export function detachMasterNode(templateId: string, nodeCode: string) {
  return api.post<{ id: string }>(`/admin/templates/${templateId}/nodes/${encodeURIComponent(nodeCode)}/detach-master`, {})
}

export function attachMasterNode(templateId: string, nodeCode: string, masterId: string) {
  return api.post<{ id: string }>(`/admin/templates/${templateId}/nodes/${encodeURIComponent(nodeCode)}/attach-master`, { masterId })
}
