// Simple map to store messages by their IDs
// This is useful when connection is re-established and we need to get the same
// message again, but now from the new connection
const EventEmitter = require('events');

const messagesDB = (() => {
    const messagesById = new Map();
    const emitter = new EventEmitter();

    return {
        getMessageById: function getMessageById(id) {
            return messagesById.get(id);
        },
        addMessage: function addMessage(id, message) {
            const existingMessage = messagesById.get(id);
            messagesById.set(id, message);
            if (existingMessage) {
                emitter.emit('message-updated', id, message);
            }
        },
        deleteMessage: function deleteMessage(id) {
            messagesById.delete(id);
        },
        on: function on(event, listener) {
            emitter.on(event, listener);
        },
        off: function off(event, listener) {
            emitter.off(event, listener);
        },
        __reset__: function reset() {
            messagesById.clear();
            emitter.removeAllListeners();
        }
    };
})();

module.exports = messagesDB;
