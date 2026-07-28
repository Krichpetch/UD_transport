// W2-S3a Part D — parseTemplateDefinition must accept the new optional TemplateNode.imageKeys
// field (additive, all pre-existing templates remain valid without it) and reject malformed
// shapes, same as it already does for the sibling lawRefs field.
import { ChecklistTemplateValidationError, parseTemplateDefinition } from '@repo/types'

function baseDefinition(leafExtra: Record<string, unknown> = {}) {
  return {
    schemaVersion: 2,
    mode: 'ทางบก',
    groups: [
      {
        code: 'A1',
        labelTh: 'ที่จอดรถ',
        items: [
          {
            code: 'A1.1',
            labelTh: 'ที่จอดรถสำหรับคนพิการ',
            answerType: 'presence',
            ...leafExtra,
          },
        ],
      },
    ],
  }
}

describe('parseTemplateDefinition — imageKeys', () => {
  it('accepts a definition with no imageKeys at all (existing templates stay valid)', () => {
    expect(() => parseTemplateDefinition(baseDefinition())).not.toThrow()
  })

  it('accepts a valid imageKeys string array', () => {
    const def = parseTemplateDefinition(baseDefinition({ imageKeys: ['template-images/a.jpg', 'template-images/b.png'] }))
    const leaf = def.groups[0]!.items[0]!
    expect(leaf.imageKeys).toEqual(['template-images/a.jpg', 'template-images/b.png'])
  })

  it('accepts an empty imageKeys array', () => {
    const def = parseTemplateDefinition(baseDefinition({ imageKeys: [] }))
    expect(def.groups[0]!.items[0]!.imageKeys).toEqual([])
  })

  it('rejects imageKeys that is not an array', () => {
    expect(() => parseTemplateDefinition(baseDefinition({ imageKeys: 'template-images/a.jpg' }))).toThrow(
      ChecklistTemplateValidationError,
    )
  })

  it('rejects an imageKeys array with a non-string element', () => {
    expect(() => parseTemplateDefinition(baseDefinition({ imageKeys: ['template-images/a.jpg', 42] }))).toThrow(
      ChecklistTemplateValidationError,
    )
  })

  it('allows imageKeys on a container node (no answerType of its own)', () => {
    const def = parseTemplateDefinition({
      schemaVersion: 2,
      mode: 'ทางบก',
      groups: [
        {
          code: 'A1',
          labelTh: 'ที่จอดรถ',
          items: [
            {
              code: 'A1.1',
              labelTh: 'ที่จอดรถสำหรับคนพิการ',
              imageKeys: ['template-images/container.jpg'],
              subItems: [{ code: 'A1.1-1', labelTh: 'sub', answerType: 'presence' }],
            },
          ],
        },
      ],
    })
    expect(def.groups[0]!.items[0]!.imageKeys).toEqual(['template-images/container.jpg'])
  })
})
