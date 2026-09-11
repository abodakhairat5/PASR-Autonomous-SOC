/**
 * Central API client for the PASR Autonomous SOC dashboard.
 *
 * All requests go through the Vite dev proxy: /api -> http://127.0.0.1:8000
 * The proxy forwards the /api prefix unchanged, matching the backend routes.
 */

const BASE = '/api'

async function request(path, options = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeout || 15000)

  try {
    const response = await fetch(`${BASE}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    })

    let data = null
    const text = await response.text()
    if (text) {
      try {
        data = JSON.parse(text)
      } catch {
        data = text
      }
    }

    if (!response.ok) {
      const detail =
        (data && data.detail) ||
        (typeof data === 'string' && data) ||
        `Request failed (${response.status})`
      throw new ApiError(detail, response.status)
    }

    return data
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new ApiError(
        'Request timed out. The backend may be slow or unresponsive.',
        0
      )
    }
    if (err instanceof TypeError) {
      throw new ApiError(
        'Cannot reach the PASR backend. Make sure FastAPI is running on port 8000.',
        0
      )
    }
    throw err
  } finally {
    clearTimeout(timeout)
  }
}

export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export const api = {
  async getHealth() {
    return request('/health', { timeout: 5000 })
  },

  async analyzeLog(rawLog) {
    return request('/analyze-log', {
      method: 'POST',
      // The 8-stage PASR pipeline can take several minutes; the Vite proxy
      // allows up to 6 minutes so this matches that window.
      timeout: 300000,
      body: JSON.stringify({ raw_log: rawLog }),
    })
  },

  async getDashboard() {
    return request('/dashboard')
  },

  async getStats() {
    return request('/stats')
  },

  async getIncidents(limit = 500) {
    return request(`/incidents?limit=${limit}`)
  },

  async getRecentIncidents(limit = 20) {
    return request(`/incidents/recent?limit=${limit}`)
  },

  async getIncidentsBySource(sourceIp) {
    return request(`/incidents/${encodeURIComponent(sourceIp)}`)
  },

  async getResponseActions(limit = 200) {
    return request(`/response-actions?limit=${limit}`)
  },

  async getAgents() {
    return request('/agents')
  },

  async getInfrastructure() {
    return request('/infrastructure')
  },

  async getSimulatedActions(limit = 50) {
    return request(`/actions/simulated?limit=${limit}`)
  },

  async simulateAction(incidentId, action) {
    return request(`/actions/${incidentId}/simulate`, {
      method: 'POST',
      timeout: 15000,
      body: JSON.stringify({ action }),
    })
  },

  // Runtime Security Rules
  async getRuntimeRules() {
    return request('/runtime/rules')
  },

  async getActiveRuntimeRules() {
    return request('/runtime/rules/active')
  },

  async getPendingRuntimeRules() {
    return request('/runtime/rules/pending')
  },

  async getRuntimeRule(ruleId) {
    return request(`/runtime/rules/${encodeURIComponent(ruleId)}`)
  },

  async validateRuntimeRule(ruleId) {
    return request(`/runtime/rules/${encodeURIComponent(ruleId)}/validate`, {
      method: 'POST',
    })
  },

  async approveRuntimeRule(ruleId) {
    return request(`/runtime/rules/${encodeURIComponent(ruleId)}/approve`, {
      method: 'POST',
    })
  },

  async applyRuntimeRule(ruleId) {
    return request(`/runtime/rules/${encodeURIComponent(ruleId)}/apply`, {
      method: 'POST',
    })
  },

  async deployRuntimeRule(ruleId) {
    return request(`/runtime/rules/${encodeURIComponent(ruleId)}/deploy`, {
      method: 'POST',
    })
  },

  async rollbackRuntimeRule(ruleId) {
    return request(`/runtime/rules/${encodeURIComponent(ruleId)}/rollback`, {
      method: 'POST',
    })
  },
}
