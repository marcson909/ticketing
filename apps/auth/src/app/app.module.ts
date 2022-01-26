import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { GLOBAL_API_PREFIX } from '@ticketing/microservices/shared/constants';
import { validate } from '@ticketing/microservices/shared/env';
import { GlobalErrorFilter } from '@ticketing/microservices/shared/filters';
import { LoggerModule } from 'nestjs-pino';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AppConfigService, EnvironmentVariables } from './env';
import { HealthModule } from './health/health.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      isGlobal: true,
      expandVariables: true,
      validate: validate(EnvironmentVariables),
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: AppConfigService) => ({
        pinoHttp: {
          level: configService.get('LOG_LEVEL'),
          autoLogging: { ignorePaths: [`/${GLOBAL_API_PREFIX}/health`] },
        },
      }),
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: AppConfigService) => ({
        uri: configService.get<string>('MONGODB_URI'),
      }),
    }),
    HealthModule,
    UsersModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_FILTER,
      useExisting: GlobalErrorFilter,
    },
    GlobalErrorFilter,
  ],
})
export class AppModule {}
