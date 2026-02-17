/**
 * Lambda handler for API Gateway.
 * Wraps the Express app with @vendia/serverless-express.
 */
import serverlessExpress from '@vendia/serverless-express';
import { app } from './server.js';

export const handler = serverlessExpress({ app });
