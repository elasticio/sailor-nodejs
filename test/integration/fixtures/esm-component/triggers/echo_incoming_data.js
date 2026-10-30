// Native ESM: named export, async process returning the outgoing message.
export async function process(msg) {
    return {
        body: {
            esm: true,
            msg
        }
    };
}
