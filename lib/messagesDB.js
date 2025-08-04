// Simple map to store messages by their IDs
// This is useful when connection is re-established and we need to get the same
// message again, but now from the new connection
const messagesDB = (() => {
    const messagesById = new Map();

    return {
        getMessageById: function getMessageById(id) {
            return messagesById.get(id);
        },
        addMessage: function addMessage(id, message) {
            messagesById.set(id, message);
        },
        deleteMessage: function deleteMessage(id) {
            messagesById.delete(id);
        },
        __reset__: function reset() {
            messagesById.clear();
        }
    };
})();

module.exports = messagesDB;
