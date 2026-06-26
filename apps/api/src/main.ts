import 'reflect-metadata'
import { json } from 'express'
import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import { AppModule } from './app.module'
import { validateEnv } from './config/validate-env'

async function bootstrap() {
  validateEnv()
  const app = await NestFactory.create(AppModule)

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
