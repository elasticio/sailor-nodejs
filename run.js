const SingleApp = require('./lib/SingleApp.js');
const MultiApp = require('./lib/MultiApp.js');
let app;
if (process.argv.includes('--service')) {
    app = new MultiApp();
} else {
    app = new SingleApp();
}
app.start();
