import { IsString } from 'class-validator'

// Era-editor safety session, Part E — moves an unattached node onto a DIFFERENT existing
// canonical item's group (facility-groups.service.ts#attachNodeToGroup). templateId/nodeCode
// together name the source node the same way propagateItemEdit's own instance targeting does.
export class AttachNodeToGroupDto {
  @IsString() templateId: string
  @IsString() nodeCode: string
}
