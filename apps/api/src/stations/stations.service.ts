import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class StationsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(filters?: {
    mode?: string
    region?: string
    responsibleAgency?: string
    status?: string
  }) {
    return this.prisma.station.findMany({
      where: {
        ...(filters?.mode && { mode: filters.mode }),
        ...(filters?.region && { region: filters.region }),
        ...(filters?.responsibleAgency && { responsibleAgency: filters.responsibleAgency }),
        ...(filters?.status && { status: filters.status }),
      },
      orderBy: { nameTh: 'asc' },
    })
  }

  findOne(id: string) {
    return this.prisma.station.findUniqueOrThrow({ where: { id } })
  }

  async summary() {
    const [total, passing, needsImprovement, failing] = await Promise.all([
      this.prisma.station.count(),
      this.prisma.station.count({ where: { status: 'ผ่านมาตรฐาน' } }),
      this.prisma.station.count({ where: { status: 'ต้องปรับปรุง' } }),
      this.prisma.station.count({ where: { status: 'ไม่ผ่าน' } }),
    ])
    return {
      totalStations: total,
      passing,
      needsImprovement,
      failing,
      passRate: total > 0 ? Math.round((passing / total) * 1000) / 10 : 0,
    }
  }
}
