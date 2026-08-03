import { IsIn } from 'class-validator'

export class ReorderNodeDto {
  @IsIn(['up', 'down']) direction: 'up' | 'down'
}
