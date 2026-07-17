import { app } from '@azure/functions';

const GOOGLE_WORKSPACE_INCIDENTS_URL =
  'https://www.google.com/appsstatus/dashboard/incidents.json';

const CACHE_MS = 300000;

let cachedPayload = null;
let cachedAt = 0;

const STATUS_SERVICES = [
  {
    id: 'denticon',
    name: 'Denticon',
    category: 'Primary Applications',
    monitorType: 'statuspage',
    url: 'https://status.planetdds.com/api/v2/summary.json'
  },
  {
    id: 'nexhealth',
    name: 'NexHealth',
    category: 'Primary Applications',
    monitorType: 'availability',
    url: 'https://www.nexhealth.com/',
    componentName: 'NexHealth Web Application'
  },
  {
    id: 'dosespot',
    name: 'DoseSpot',
    category: 'Primary Applications',
    monitorType: 'availability',
    url: 'https://status.dosespot.com/',
    componentName: 'DoseSpot Status Service'
  },
  {
    id: 'nextiva',
    name: 'Nextiva',
    category: 'Communications & Business Applications',
    monitorType: 'statuspage',
    url: 'https://status.nextiva.com/api/v2/summary.json'
  },
  {
    id: 'deputy',
    name: 'Deputy',
    category: 'Communications & Business Applications',
    monitorType: 'statuspage',
    url: 'https://status.deputy.com/api/v2/summary.json'
  },
  {
    id: 'paychex',
    name: 'Paychex Flex',
    category: 'Communications & Business Applications',
    monitorType: 'availability',
    url: 'https://myapps.paychex.com/',
    componentName: 'Paychex Flex Login'
  },
  {
    id: 'googleworkspace',
    name: 'Google Workspace',
    category: 'Cloud & Productivity Services',
    monitorType: 'googleWorkspace',
    productId: ''
  },
  {
    id: 'appsheet',
    name: 'AppSheet',
    category: 'Cloud & Productivity Services',
    monitorType: 'googleWorkspace',
    productId: 'FWjKi5U7KX4FUUPThHAJ'
  },
  {
    id: 'microsoft365',
    name: 'Microsoft 365',
    category: 'Cloud & Productivity Services',
    monitorType: 'availability',
    url: 'https://portal.office.com/servicestatus',
    componentName: 'Microsoft 365 Service Status'
  },
  {
    id: 'azure',
    name: 'Microsoft Azure',
    category: 'Cloud & Productivity Services',
    monitorType: 'availability',
    url: 'https://azure.status.microsoft/en-us/status/',
    componentName: 'Azure Public Status'
  },
  {
    id: 'aws',
    name: 'Amazon Web Services',
    category: 'Cloud & Productivity Services',
    monitorType: 'availability',
    url: 'https://health.aws.amazon.com/health/status',
    componentName: 'AWS Health Dashboard'
  },
  {
    id: '3shape',
    name: '3Shape',
    category: 'Dental Technology',
    monitorType: 'availability',
    url: 'https://status.3shape.com/',
    componentName: '3Shape Status Service'
  },
  {
    id: 'trios',
    name: 'TRIOS / Unite Cloud',
    category: 'Dental Technology',
    monitorType: 'availability',
    url: 'https://unite.3shape.com/',
    componentName: 'TRIOS Unite Cloud'
  },
  {
    id: 'claude',
    name: 'Claude',
    category: 'AI Services',
    monitorType: 'statuspage',
    url: 'https://status.claude.com/api/v2/summary.json'
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    category: 'AI Services',
    monitorType: 'statuspage',
    url: 'https://status.openai.com/api/v2/summary.json'
  },
  {
    id: 'zai',
    name: 'Z.AI',
    category: 'AI Services',
    monitorType: 'availability',
    url: 'https://z.ai/',
    componentName: 'Z.AI Web Application'
  }
];

app.http('status', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'status',
  handler: async () => {
    try {
      const now = Date.now();

      if (cachedPayload && now - cachedAt < CACHE_MS) {
        return {
          status: 200,
          jsonBody: cachedPayload
        };
      }

      const services = await fetchAllStatuses();

      const payload = {
        success: true,
        source: 'azure-functions',
        generatedAt: new Date().toISOString(),
        services
      };

      cachedPayload = payload;
      cachedAt = now;

      return {
        status: 200,
        jsonBody: payload
      };
    } catch (error) {
      return {
        status: 500,
        jsonBody: {
          success: false,
          source: 'azure-functions',
          generatedAt: new Date().toISOString(),
          error: error?.message || String(error)
        }
      };
    }
  }
});

async function fetchAllStatuses() {
  const checkedTime = new Date().toLocaleString('en-US');

  let googleIncidents = null;
  let googleError = null;

  try {
    googleIncidents = await fetchJson(GOOGLE_WORKSPACE_INCIDENTS_URL);
  } catch (error) {
    googleError = error;
  }

  const servicePromises = STATUS_SERVICES.map(async (service) => {
    try {
      if (service.monitorType === 'statuspage') {
        const data = await fetchJson(service.url);
        return parseStatuspageService(service, data, checkedTime);
      }

      if (service.monitorType === 'googleWorkspace') {
        if (googleError) throw googleError;
        return buildGoogleWorkspaceService(service, googleIncidents, checkedTime);
      }

      return await parseAvailabilityService(service, checkedTime);
    } catch (error) {
      return createErrorStatus(service, error, checkedTime);
    }
  });

  return Promise.all(servicePromises);
}

async function fetchJson(url) {
  const response = await fetchWithTimeout(url);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    return await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'user-agent': 'PureDentalStatusDashboard/1.0'
      }
    });
  } finally {
    clearTimeout(timeout);
  }
}

function parseStatuspageService(service, data, checkedTime) {
  const incidents = (data.incidents || [])
    .filter((incident) => {
      const status = String(incident.status || '').toLowerCase();
      return !['resolved', 'completed', 'postmortem'].includes(status);
    })
    .map((incident) => {
      const latestUpdate = incident.incident_updates?.[0] || null;

      return {
        id: incident.id || '',
        name: incident.name || 'Service incident',
        status: incident.status || 'unknown',
        impact: incident.impact || 'unknown',
        link: incident.shortlink || '',
        updatedAt: incident.updated_at || '',
        latestUpdate: latestUpdate?.body || '',
        affectedComponents: (latestUpdate?.affected_components || []).map(
          (component) => component.name
        )
      };
    });

  const rawIndicator = data.status?.indicator || 'unknown';

  return {
    id: service.id,
    service: service.name,
    category: service.category,
    indicator: normalizeIndicator(rawIndicator),
    rawIndicator,
    description: data.status?.description || 'Status unavailable',
    components: (data.components || []).map((component) => ({
      name: component.name,
      status: component.status
    })),
    incidents,
    maintenance: filterActiveMaintenance(data.scheduled_maintenances || []),
    checked: checkedTime,
    error: ''
  };
}

async function parseAvailabilityService(service, checkedTime) {
  const response = await fetchWithTimeout(service.url);

  const isAvailable = response.status >= 200 && response.status < 400;

  if (!isAvailable) {
    return {
      id: service.id,
      service: service.name,
      category: service.category,
      indicator: 'critical',
      rawIndicator: 'major_outage',
      description: 'Service is not responding',
      components: [
        {
          name: service.componentName || service.name,
          status: 'major_outage'
        }
      ],
      incidents: [],
      maintenance: [],
      checked: checkedTime,
      error: `HTTP ${response.status}`
    };
  }

  return {
    id: service.id,
    service: service.name,
    category: service.category,
    indicator: 'operational',
    rawIndicator: 'operational',
    description: 'Service is responding',
    components: [
      {
        name: service.componentName || service.name,
        status: 'operational'
      }
    ],
    incidents: [],
    maintenance: [],
    checked: checkedTime,
    error: ''
  };
}

function buildGoogleWorkspaceService(service, allIncidents, checkedTime) {
  const relevantIncidents = (allIncidents || []).filter((incident) => {
    if (service.productId) {
      const products = incident.affected_products || [];
      const affectsProduct = products.some(
        (product) => product.id === service.productId
      );

      if (!affectsProduct) return false;
    }

    return isGoogleIncidentActive(incident);
  });

  const incidents = relevantIncidents.map((incident) => {
    const latest = incident.most_recent_update || {};
    const products = incident.affected_products || [];

    return {
      id: incident.id || '',
      name:
        extractGoogleIncidentTitle(latest.text || incident.external_desc) ||
        incident.service_name ||
        'Google service incident',
      status: mapGoogleIncidentStatus(latest.status),
      impact: mapGoogleImpact(incident.status_impact),
      link: `https://www.google.com/appsstatus/dashboard/${incident.uri || ''}`,
      updatedAt:
        latest.when || latest.modified || incident.modified || '',
      latestUpdate: cleanGoogleIncidentText(
        latest.text || incident.external_desc || ''
      ),
      affectedComponents: products.map((product) => product.title)
    };
  });

  const indicator =
    incidents.length > 0
      ? getGoogleOverallIndicator(relevantIncidents)
      : 'operational';

  return {
    id: service.id,
    service: service.name,
    category: service.category,
    indicator,
    rawIndicator: indicator,
    description:
      incidents.length > 0
        ? `${incidents.length} active incident${incidents.length === 1 ? '' : 's'}`
        : 'All services operational',
    components: buildGoogleComponents(service, relevantIncidents),
    incidents,
    maintenance: [],
    checked: checkedTime,
    error: ''
  };
}

function filterActiveMaintenance(items) {
  return items.filter((item) => {
    const status = String(item.status || '').toLowerCase();
    return !['completed', 'resolved', 'postmortem'].includes(status);
  });
}

function isGoogleIncidentActive(incident) {
  const latest = incident.most_recent_update || {};
  const latestStatus = String(latest.status || '').toUpperCase();

  if (incident.end) return false;

  return latestStatus !== 'AVAILABLE';
}

function getGoogleOverallIndicator(incidents) {
  const hasOutage = incidents.some(
    (incident) =>
      String(incident.status_impact || '').toUpperCase() === 'SERVICE_OUTAGE'
  );

  if (hasOutage) return 'critical';

  const hasDisruption = incidents.some(
    (incident) =>
      String(incident.status_impact || '').toUpperCase() ===
      'SERVICE_DISRUPTION'
  );

  if (hasDisruption) return 'major';

  return 'minor';
}

function buildGoogleComponents(service, incidents) {
  if (service.productId) {
    return [
      {
        name: service.name,
        status:
          incidents.length > 0
            ? googleIncidentComponentStatus(incidents)
            : 'operational'
      }
    ];
  }

  if (incidents.length === 0) {
    return [
      {
        name: 'Google Workspace',
        status: 'operational'
      }
    ];
  }

  const componentMap = {};

  incidents.forEach((incident) => {
    (incident.affected_products || []).forEach((product) => {
      const newStatus = googleIncidentComponentStatus([incident]);
      const existingStatus = componentMap[product.title];

      componentMap[product.title] = getMoreSevereComponentStatus(
        existingStatus,
        newStatus
      );
    });
  });

  return Object.keys(componentMap)
    .sort()
    .map((name) => ({
      name,
      status: componentMap[name]
    }));
}

function getMoreSevereComponentStatus(existingStatus, newStatus) {
  if (!existingStatus) return newStatus;

  const ranks = {
    major_outage: 1,
    partial_outage: 2,
    degraded_performance: 3,
    operational: 4
  };

  return (ranks[newStatus] || 99) < (ranks[existingStatus] || 99)
    ? newStatus
    : existingStatus;
}

function googleIncidentComponentStatus(incidents) {
  const indicator = getGoogleOverallIndicator(incidents);

  if (indicator === 'critical') return 'major_outage';
  if (indicator === 'major') return 'partial_outage';

  return 'degraded_performance';
}

function mapGoogleIncidentStatus(status) {
  const value = String(status || '').toUpperCase();

  if (value === 'AVAILABLE') return 'resolved';
  if (value === 'SERVICE_OUTAGE') return 'identified';

  return 'investigating';
}

function mapGoogleImpact(impact) {
  const value = String(impact || '').toUpperCase();

  if (value === 'SERVICE_OUTAGE') return 'critical';
  if (value === 'SERVICE_DISRUPTION') return 'major';

  return 'minor';
}

function extractGoogleIncidentTitle(text) {
  const content = String(text || '');

  const titleMatch = content.match(/\*\*Title\*\*\s*\n?([^\n]+)/i);

  if (titleMatch?.[1]) {
    return titleMatch[1].replace(/^\[Resolved\]\s*/i, '').trim();
  }

  const summaryMatch = content.match(/\*\*Summary\*\*\s*\n?([^\n]+)/i);

  return summaryMatch?.[1] ? summaryMatch[1].trim() : '';
}

function cleanGoogleIncidentText(text) {
  return String(text || '')
    .replace(/\*\*/g, '')
    .replace(/^Title\s*/i, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function createErrorStatus(service, error, checkedTime) {
  return {
    id: service.id,
    service: service.name,
    category: service.category,
    indicator: 'unknown',
    rawIndicator: 'unknown',
    description: 'Unable to retrieve status',
    components: [],
    incidents: [],
    maintenance: [],
    checked: checkedTime,
    error: error?.message || String(error || 'Unknown error')
  };
}

function normalizeIndicator(indicator) {
  const value = String(indicator || 'none').toLowerCase();

  if (value === 'none' || value === 'operational') return 'operational';
  if (value === 'minor' || value === 'degraded_performance') return 'minor';
  if (value === 'major' || value === 'partial_outage') return 'major';
  if (value === 'critical' || value === 'major_outage') return 'critical';
  if (value === 'maintenance' || value === 'under_maintenance') return 'maintenance';

  return 'unknown';
}
