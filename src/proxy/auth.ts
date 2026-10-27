import jwt from 'jsonwebtoken';
import type { Settings } from '../settings/index.ts';

export type ProxyAuthSettings = Pick<Settings, 'API_USERNAME' | 'API_KEY' | 'SAILOR_PROXY_JWT_SECRET' | 'STEP_ID'
    | 'PROXY_CLIENT_ID' | 'EXEC_ID' | 'CONTAINER_ID' | 'WORKSPACE_ID' | 'USER_ID' | 'COMP_ID' | 'FUNCTION'>;

/** Builds the `Authorization` header value: a JWT signed with SAILOR_PROXY_JWT_SECRET. */
export function createProxyAuthHeader(settings: ProxyAuthSettings): string {
    if (!settings.PROXY_CLIENT_ID) {
        throw new Error('PROXY_CLIENT_ID must be set to connect to Sailor Proxy');
    }
    const username = settings.API_USERNAME;
    const password = settings.API_KEY;
    if (!username || !password) {
        throw new Error('API_USERNAME and API_KEY must be set to connect to Sailor Proxy');
    }
    const secret = settings.SAILOR_PROXY_JWT_SECRET;
    if (!secret) {
        throw new Error('SAILOR_PROXY_JWT_SECRET must be set to connect to Sailor Proxy');
    }
    const token = jwt.sign({
        username,
        password,
        stepId: settings.STEP_ID,
        clientId: settings.PROXY_CLIENT_ID,
        execId: settings.EXEC_ID,
        containerId: settings.CONTAINER_ID,
        workspaceId: settings.WORKSPACE_ID,
        userId: settings.USER_ID,
        compId: settings.COMP_ID,
        function: settings.FUNCTION
    }, secret);
    return `Bearer ${token}`;
}
