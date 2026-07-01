import { Injectable } from '@nestjs/common'
import { ThrottlerGuard } from '@nestjs/throttler'

// Use user ID as throttle key for authenticated requests so a shared office/proxy
// IP doesn't bucket multiple users into one limit. Falls back to IP for unauthed routes.
@Injectable()
export class UserAwareThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const user = req['user'] as { id?: string } | undefined
    if (user?.id) return `user:${user.id}`
    const ip = req['ip'] as string | undefined
    return ip ?? 'unknown'
  }
}
