import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { StationsService } from './stations.service'

@Controller('stations')
@UseGuards(JwtAuthGuard)
export class StationsController {
  constructor(private readonly stations: StationsService) {}

  @Get('summary')
  summary() {
    return this.stations.summary()
  }

  @Get()
  findAll(
    @Query('mode') mode?: string,
    @Query('region') region?: string,
    @Query('agency') responsibleAgency?: string,
    @Query('status') status?: string,
  ) {
    return this.stations.findAll({ mode, region, responsibleAgency, status })
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.stations.findOne(id)
  }
}
