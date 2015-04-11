var log = require('verr-log')();
var path = require('path');
var async = require('async');
var _ = require('lodash');
var shortId = require('shortid');

var acc = require('any2api-access');
var util = require('any2api-util');



module.exports = function(spec) {
  var obj = {};

  obj.invoke = function(args, done) {
    args = args || {};

    var apiSpec = args.apiSpec;
    if (!apiSpec) return done(new Error('API spec missing'));

    var params = args.parameters;
    if (!params) return done(new Error('parameters missing'));

    if (!params.cmd) return done(new Error('cmd parameter missing'));

    var config = params.invoker_config || {};

    config.access = config.access || 'local';
    config.stdin = config.stdin || '';
    config.env = config.env || {};

    var instanceParams = params._;
    delete params._;

    instanceParams.instance_id = instanceParams.instance_id || uuid.v4();

    if (!instanceParams.instance_path) return done(new Error('_.instance_path parameter missing'));

    var executable = apiSpec.executables[instanceParams.executable_name] || {};
    var invoker = apiSpec.invokers[instanceParams.invoker_name] || apiSpec.invokers[executable.invoker_name];

    var localExecPath = path.resolve(apiSpec.apispec_path, '..', executable.path);
    var localInstancePath = instanceParams.instance_path;
    var remoteInstancePath = path.join('/', 'tmp', shortId.generate());
    var remoteCwdPath = config.cwd || remoteInstancePath;

    config.env.INSTANCE_PATH = remoteInstancePath;

    // Find parameters that need to be mapped to environment variables
    _.each(util.getMappedParametersSync({
      apiSpec: apiSpec,
      executable_name: instanceParams.executable_name,
      parameters: params,
      mappingType: 'env'
    }), function(def, name) {
      if (!config.env[name] && def.value) {
        config.env[name] = def.value;
      }
    });

    // Find parameter that need to be mapped to stdin
    _.each(util.getMappedParametersSync({
      apiSpec: apiSpec,
      executable_name: instanceParams.executable_name,
      parameters: params,
      mappingType: 'stdin'
    }), function(def, name) {
      if (!_.isEmpty(config.stdin) && def.value) {
        config.stdin = def.value;
      }
    });

    var access;

    if (acc[config.access]) {
      access = acc[config.access](config);
    } else {
      return done(new Error('access \'' + config.access + '\' not supported'));
    }



    var run = function(done) {
      async.series([
        async.apply(access.remove, { path: remoteInstancePath }),
        async.apply(access.mkdir, { path: path.join(remoteInstancePath, '..') }),
        async.apply(access.copyDirToRemote, { sourcePath: localExecPath, targetPath: remoteInstancePath }),
        async.apply(util.writeParameters, {
          apiSpecPath: apiSpec.apispec_path,
          apiSpecEnriched: apiSpec.enriched,
          executable: executable,
          invoker: invoker,
          parameters: params,
          remotePath: remoteInstancePath,
          access: access
        }),
        async.apply(access.mkdir, { path: remoteCwdPath }),
        function(callback) {
          access.exec({
            command: params.cmd,
            env: config.env,
            stdin: config.stdin,
            cwd: remoteCwdPath,
            encodingStdout: config.encoding_stdout,
            encodingStderr: config.encoding_stderr,
            printStdout: true,
            printStderr: true
          }, function(err, stdout, stderr) {
            if (err) {
              err.stderr = stderr;
              err.stdout = stdout;

              return callback(err);
            }

            callback();
          });
        },
        async.apply(util.collectResults, {
          apiSpecPath: apiSpec.apispec_path,
          apiSpecEnriched: apiSpec.enriched,
          executable: executable,
          invoker: invoker,
          localPath: localInstancePath,
          remotePath: remoteInstancePath,
          access: access
        })
      ], done);
    };



    async.series([
      async.apply(run)
    ], function(err) {
      async.series([
        async.apply(access.terminate)
      ], function(err2) {
        if (err2) log.error(err2);

        done(err);
      });
    });
  };

  return obj;
};
