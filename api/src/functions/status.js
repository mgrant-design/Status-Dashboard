import { app } from '@azure/functions';

app.http('status', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'status',
  handler: async () => {
    return {
      status: 200,
      jsonBody: {
        success: true,
        source: 'azure-functions',
        message: 'Pure Dental Azure API is working',
        generatedAt: new Date().toISOString(),
        services: []
      }
    };
  }
});
