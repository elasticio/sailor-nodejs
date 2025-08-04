// Simple map to store messages by their IDs
// TODO: what pupropse?
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
