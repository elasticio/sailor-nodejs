exports.getMetaModel = getMetaModel;

function getMetaModel (cfg) {
    return Promise.resolve({
        in: {
            type: 'object',
            properties: {
                email: {
                    type: 'string',
                    title: 'E-Mail'
                }
            }
        }
    });
}
