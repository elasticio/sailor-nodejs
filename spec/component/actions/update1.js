exports.getMetaModel = function getMetaModel() {
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
};
