/**
 * Used to communicate with parent processes.
 */
class IPC {
    send(event, data) {
        if (!process.send) {
            return;
        }
        process.send({ event, data });
    }
}

exports.IPC = IPC;
