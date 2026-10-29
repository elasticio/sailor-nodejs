import type { Settings } from '../settings/index.ts';
import type { MessageMetadata } from '../proxy/codec.ts';
import type { OutgoingMetadata } from '../proxy/client.ts';
import _ from 'lodash';

/** `ADDITIONAL_VARS_FOR_HEADERS` values, keys in snake_case. */
export function additionalMetadata(settings: Settings): Record<string, string | undefined> {
    return Object.fromEntries(Object.entries(settings.additionalVars ?? {}).map(([k, v]) => [_.snakeCase(k), v]));
}

/** Metadata identifying this step, sent with every outgoing message (and `reportError`). */
export function stepMetadata(settings: Settings): OutgoingMetadata {
    return {
        ...additionalMetadata(settings),
        execId: settings.EXEC_ID,
        taskId: settings.FLOW_ID,
        workspaceId: settings.WORKSPACE_ID,
        containerId: settings.CONTAINER_ID,
        userId: settings.USER_ID,
        stepId: settings.STEP_ID,
        compId: settings.COMP_ID,
        function: settings.FUNCTION
    };
}

/** Metadata for messages emitted while processing `incoming`. */
export function outgoingMetadataFor(settings: Settings, incoming: MessageMetadata): OutgoingMetadata {
    const metadata: OutgoingMetadata = {
        ...incoming,
        ...stepMetadata(settings),
        parentMessageId: incoming.messageId,
        threadId: incoming.threadId,
        start: Date.now()
    };
    delete metadata.messageId;
    return metadata;
}
