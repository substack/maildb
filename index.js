var sublevel = require('level-sublevel/bytewise');
var bytewise = require('bytewise');
var cas = require('content-addressable-store');
var through = require('through2');
var split = require('split');
var headers = require('parse-header-stream');
var batch = require('level-create-batch');

module.exports = Mail;

function Mail (db, opts) {
    if (!(this instanceof Mail)) return new Mail(db, opts);
    if (!opts) opts = {};
    this.db = sublevel(db, {
        keyEncoding: bytewise,
        valueEncoding: 'json'
    });
    this.store = cas(opts.dir || './mail.db');
}

Mail.prototype.save = function () {
    var self = this;
    var stream = through();
    var rows = [];
    var h = stream.pipe(this.store.addStream());
    h.on('end', function () {
        batch(self.db, [
            { type: 'create', key: [ 'email', h.hash ], value: fields },
            { type: 'put', key: [ 'from', fields.from, h.hash ], value: 0 },
            { type: 'put', key: [ 'date', Date.now(), h.hash ], value: 0 },
            { type: 'put', key: [ 'recent', h.hash ], value: 0 },
            { type: 'put', key: [ 'unseen', h.hash ], value: 0 },
        ], function (err) { if (err) stream.emit('error', err) });
    });
    stream.pipe(headers(function (err, fields_) {
        if (err) stream.emit('error', err);
        fields = fields_;
    }));
    return stream;
};

Mail.prototype.search = function () {
    var db = this.db;
    var stream = db.createReadStream({
        gt: [ 'date', null ],
        lt: [ 'date', undefined ]
    });
    return stream.pipe(through.obj(function (row, enc, next) {
        var hash = row.key[2];
        this.push(hash);
        next();
    }));
};
