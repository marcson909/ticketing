import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { CustomStrategy, Transport } from '@nestjs/microservices';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import {
  DocumentBuilder,
  SwaggerCustomOptions,
  SwaggerModule,
} from '@nestjs/swagger';
import { Listener } from '@nestjs-plugins/nestjs-nats-streaming-transport';
import {
  bearerSecurityScheme,
  getCookieOptions,
  GLOBAL_API_PREFIX,
  SecurityRequirements,
  sessionSecurityScheme,
} from '@ticketing/microservices/shared/constants';
import { Resources, Services } from '@ticketing/shared/constants';
import fastifyCors from 'fastify-cors';
import { fastifyHelmet } from 'fastify-helmet';
import fastifyPassport from 'fastify-passport';
import fastifySecureSession from 'fastify-secure-session';
import { existsSync, writeFileSync } from 'fs';
import { Logger } from 'nestjs-pino';
import { resolve } from 'path';

import { AppModule } from './app/app.module';
import { AppConfigService } from './app/env';
import { APP_FOLDER, DEFAULT_PORT } from './app/shared/constants';

// eslint-disable-next-line max-lines-per-function
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      trustProxy: true,
      bodyLimit: 1048576,
      // bodyLimit: +process.env.MAX_PAYLOAD_SIZE || 5,
      // maxParamLength: 100,
    }),
    { bufferLogs: true }
  );

  const configService = app.get<AppConfigService>(ConfigService);
  const port = configService.get('PORT', DEFAULT_PORT, { infer: true });
  const environment = configService.get('NODE_ENV', { infer: true });
  const swaggerUiPrefix = configService.get('SWAGGER_PATH', { infer: true });
  const proxyServerUrls = configService.get('PROXY_SERVER_URLS', {
    infer: true,
  });

  const logger = app.get(Logger);
  app.useLogger(logger);
  app.setGlobalPrefix(GLOBAL_API_PREFIX);

  // Fastify
  app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: [`'self'`],
        styleSrc: [`'self'`, `'unsafe-inline'`],
        imgSrc: [`'self'`, 'data:', 'validator.swagger.io'],
        scriptSrc: [`'self'`, `https: 'unsafe-inline'`],
      },
    },
  });
  app.register(fastifySecureSession, {
    key: configService.get('SESSION_KEY'),
    cookie: getCookieOptions(environment),
  });
  app.register(fastifyPassport.initialize());
  app.register(fastifyPassport.secureSession());
  if (!proxyServerUrls.length) {
    app.register(fastifyCors, {
      origin: '*',
      // allowedHeaders: ALLOWED_HEADERS,
      // exposedHeaders: EXPOSED_HEADERS,
      allowedHeaders: '*',
      exposedHeaders: '*',
    });
  }

  // NATS
  const natsListener = new Listener(
    configService.get('NATS_CLUSTER_ID'),
    configService.get('NATS_CLIENT_ID'),
    `${Services.ORDERS_SERVICE}_GROUP`,
    { url: configService.get('NATS_URL'), name: Services.ORDERS_SERVICE },
    {
      durableName: `${Services.ORDERS_SERVICE}_subscriptions`,
      manualAckMode: true,
      deliverAllAvailable: true,
      ackWait: 5 * 1000,
    }
  );
  natsListener.transportId = Transport.NATS;
  const options: CustomStrategy = {
    strategy: natsListener,
  };
  const microService = app.connectMicroservice(options);

  // Swagger UI
  const documentBuilder = new DocumentBuilder()
    .setTitle('Orders API')
    .setDescription('Ticketing orders API description')
    .setVersion(configService.get('APP_VERSION'))
    .addSecurity(SecurityRequirements.Session, sessionSecurityScheme)
    .addSecurity(SecurityRequirements.Bearer, bearerSecurityScheme)
    .addSecurityRequirements(SecurityRequirements.Session)
    .addSecurityRequirements(SecurityRequirements.Bearer)
    .addServer(configService.get('SERVER_URL'))
    .addTag(Resources.ORDERS);

  if (proxyServerUrls.length) {
    for (const serverUrl of proxyServerUrls) {
      documentBuilder.addServer(serverUrl);
    }
  }
  const document = SwaggerModule.createDocument(app, documentBuilder.build());
  const customOptions: SwaggerCustomOptions = {
    swaggerOptions: {
      persistAuthorization: true,
    },
  };
  SwaggerModule.setup(swaggerUiPrefix, app, document, customOptions);

  // Save OpenAPI specs
  const openApiPath = resolve(APP_FOLDER, 'openapi.json');
  if (existsSync(APP_FOLDER)) {
    writeFileSync(openApiPath, JSON.stringify(document, null, 2));
  }

  // Init
  await microService.listen();
  await app.listen(port, '0.0.0.0', () => {
    logger.log(`Listening at http://localhost:${port}/${GLOBAL_API_PREFIX}`);
    logger.log(
      `Access SwaggerUI at http://localhost:${port}/${swaggerUiPrefix}`
    );
  });
}

bootstrap();
