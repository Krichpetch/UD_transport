import 'dotenv/config'
import 'reflect-metadata'
import { json, type Express } from 'express'
import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import { AppModule } from './app.module'
import { validateEnv, isProximityBypassActive } from './config/validate-env'

async function bootstrap() {
  validateEnv()
  if (isProximityBypassActive()) {
    console.warn('='.repeat(60))
    console.warn('⚠ PROXIMITY BYPASS ACTIVE — checklist location gate is disabled.')
    console.warn('  This build MUST NOT be used in production.')
    console.warn('='.repeat(60))
  }
  const app = await NestFactory.create(AppModule)

  // The web app now proxies every browser request server-side (BFF), so without
  // trust proxy every request would carry the Next server's IP — bucketing all
  // users into one login-throttle key and writing the wrong IP to AuditLog.
  // Trusting X-Forwarded-For (the BFF forwards the real client IP; Railway's edge
  // appends its own) makes req.ip the real client again. Safe here: the API is
  // only ever reached through Railway's proxy in every deployed environment.
  ;(app.getHttpAdapter().getInstance() as Express).set('trust proxy', true)

  app.use(json({ limit: '10mb' }))

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  )

  app.enableCors({ origin: process.env.FRONTEND_URL! })

  const port = Number(process.env.PORT ?? 3001)
  await app.listen(port)
  console.log(`API running on http://localhost:${port}`)
}

void bootstrap()
