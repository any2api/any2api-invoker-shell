//var path = require('path');
var async = require('async');
var _ = require('lodash');

var access = require('any2api-access');
var util = require('any2api-util');



module.exports = util.createInvoker({
  accessModule: access,
  gatherParameters: [ { name: 'cmd' } ],
  invoke: function(ctx, callback) {
    if (!ctx.unmappedParameters.cmd) return callback(new Error('cmd parameter missing'));

    var run = function(callback) {
      async.series([
        //async.apply(ctx.access.remove, { path: ctx.instancePath }),
        async.apply(ctx.access.mkdir, { path: ctx.instancePath }),
        async.apply(ctx.access.mkdir, { path: ctx.invokerConfig.cwd }),
        function(callback) {
          if (!ctx.executablePath) return callback();

          ctx.access.copyDirToRemote({ sourcePath: ctx.executablePath, targetPath: ctx.instancePath }, callback);
        },
        function(callback) {
          ctx.access.exec({
            command: ctx.unmappedParameters.cmd,
            env: ctx.invokerConfig.env,
            stdin: ctx.invokerConfig.stdin || '',
            cwd: ctx.invokerConfig.cwd,
            encodingStdout: ctx.invokerConfig.encoding_stdout,
            encodingStderr: ctx.invokerConfig.encoding_stderr
            //printStdout: true,
            //printStderr: true
          }, ctx.accessExecCallback(callback));
        }
      ], callback);
    };

    try {
      if (!_.isEmpty(ctx.invokerConfig.args)) {
        ctx.unmappedParameters.cmd = _.template(ctx.unmappedParameters.cmd)(ctx.invokerConfig.args);
      }
    } catch (err) {
      return callback(new Error('error while building command using args: ' + err.message));
    }

    async.series([
      async.apply(run)
    ], callback);
  }
});
