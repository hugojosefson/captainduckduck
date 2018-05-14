/**
 * Created by kasra on 27/06/17.
 */
const Configstore = require('configstore');
const uuid = require('uuid/v4');
const isValidPath = require('is-valid-path');
const fs = require('fs-extra');
const ApiStatusCodes = require('../api/ApiStatusCodes');
const CaptainConstants = require('../utils/CaptainConstants');
const {checkNameAvailability} = require('../utils/Availability');
const Logger = require('../utils/Logger');

const dockerfilesRoot = __dirname + '/../dockerfiles/';

const NAMESPACE = 'namespace';
const HASHED_PASSWORD = 'hashedPassword';
const CAPTAIN_REGISTRY_AUTH_SECRET_VER = 'captainRegistryAuthSecretVer';
const CUSTOM_DOMAIN = 'customDomain';
const HAS_ROOT_SSL = 'hasRootSsl';
const FORCE_ROOT_SSL = 'forceRootSsl';
const HAS_REGISTRY_SSL = 'hasRegistrySsl';
const HAS_LOCAL_REGISTRY = 'hasLocalRegistry';
const APP_DEFINITIONS = 'appDefinitions';
const EMAIL_ADDRESS = 'emailAddress';
const NET_DATA_INFO = 'netDataInfo';
const NGINX_BASE_CONFIG = 'NGINX_BASE_CONFIG';
const NGINX_CAPTAIN_CONFIG = 'NGINX_CAPTAIN_CONFIG';
const DEFAULT_CAPTAIN_ROOT_DOMAIN = 'captain.localhost';

const DEFAULT_NGINX_BASE_CONFIG = fs.readFileSync(__dirname + '/../template/base-nginx-conf.ejs').toString();
const DEFAULT_NGINX_CAPTAIN_CONFIG = fs.readFileSync(__dirname + '/../template/root-nginx-conf.ejs').toString();
const DEFAULT_NGINX_CONFIG_FOR_APP = fs.readFileSync(__dirname + '/../template/server-block-conf.ejs').toString();

function isNameAllowed(name) {
    let isNameFormattingOk = (!!name) && (name.length < 50) && (name === '@' || /^[a-z]/.test(name) && /[a-z0-9]$/.test(name) && /^[a-z0-9\-]+$/.test(name) && name.indexOf('--') < 0);
}

function isAppNameAllowed(name) {
    return name === '@' || isNameAllowed(name);
    return isNameFormattingOk && (['captain', 'registry'].indexOf(name) < 0);
}

class DataStore {

    constructor(namespace) {

        let data = new Configstore('captain-store', {});
        data.path = CaptainConstants.captainRootDirectory + '/config.conf';

        this.data = data;
        this.data.set(NAMESPACE, namespace);
    }

    getNameSpace() {
        return this.data.get(NAMESPACE);
    }

    setHashedPassword(newHashedPassword) {
        const self = this;
        return Promise.resolve()
            .then(function () {
                return self.data.set(HASHED_PASSWORD, newHashedPassword)
            });
    }

    getHashedPassword() {
        const self = this;
        return Promise.resolve()
            .then(function () {
                return self.data.get(HASHED_PASSWORD)
            });
    }

    /*
			"smtp": {
				"to": "",
				"hostname": "",
				"server": "",
				"port": "",
				"allowNonTls": false,
				"password": "",
				"username": ""
			},
			"slack": {
				"hook": "",
				"channel": ""
			},
			"telegram": {
				"botToken": "",
				"chatId": ""
			},
			"pushBullet": {
				"fallbackEmail": "",
				"apiToken": ""
			}
     */
    getNetDataInfo() {
        const self = this;
        return Promise.resolve()
            .then(function () {
                let netDataInfo = self.data.get(NET_DATA_INFO) || {};
                netDataInfo.isEnabled = netDataInfo.isEnabled || false;
                netDataInfo.data = netDataInfo.data || {};
                return netDataInfo;
            });
    }

    setNetDataInfo(netDataInfo) {
        const self = this;
        return Promise.resolve()
            .then(function () {
                return self.data.set(NET_DATA_INFO, netDataInfo)
            });
    }

    setRegistryAuthSecretVersion(ver) {
        const self = this;
        return Promise.resolve()
            .then(function () {
                return self.data.set(CAPTAIN_REGISTRY_AUTH_SECRET_VER, Number(ver))
            });
    }

    getRegistryAuthSecretVersion() {
        const self = this;
        return Promise.resolve()
            .then(function () {
                return (self.data.get(CAPTAIN_REGISTRY_AUTH_SECRET_VER) || 0);
            });
    }

    getServiceName(appName) {
        return 'srv-' + this.getNameSpace() + '--' + (appName === '@' ? '--' : appName);
    }

    getImageName(authObj, appName, version) {

        let authPrefix = '';

        if (authObj) {
            authPrefix = authObj.serveraddress + '/' + authObj.username + '/';
        }

        return authPrefix + this.getImageNameWithoutAuthObj(appName, version);
    }

    getImageNameWithoutAuthObj(appName, version) {

        if (version === 0) {
            version = '0';
        }

        return this.getImageNameBase() + (appName === '@' ? '--' : appName) + (version ? (':' + version) : '');
    }

    getImageNameBase() {
        return 'img-' + this.getNameSpace() + '--';
    }

    getRootDomain() {
        return this.data.get(CUSTOM_DOMAIN) || DEFAULT_CAPTAIN_ROOT_DOMAIN;
    }

    hasCustomDomain() {
        return !!this.data.get(CUSTOM_DOMAIN);
    }

    enableSslForDefaultSubDomain(appName) {

        const self = this;

        return this.getAppDefinitions()
            .then(function (allApps) {

                let app = allApps[appName];

                if (!app) {
                    throw new Error('App could not be found ' + appName);
                }

                app.hasDefaultSubDomainSsl = true;

                self.data.set(APP_DEFINITIONS + '.' + appName, app);

                return true;

            });
    }

    verifyCustomDomainBelongsToApp(appName, customDomain) {
        const self = this;

        return self.getAppDefinitions()
            .then(function (allApps) {

                let app = allApps[appName];

                if (!app) {
                    throw new Error('App could not be found ' + appName);
                }

                app.customDomain = app.customDomain || [];

                if (app.customDomain.length > 0) {
                    for (let idx = 0; idx < app.customDomain.length; idx++) {
                        if (app.customDomain[idx].publicDomain === customDomain) {
                            return true;
                        }
                    }
                }

                throw new Error('customDomain: ' + customDomain + ' is not attached to app ' + appName);

            });
    }

    enableCustomDomainSsl(appName, customDomain) {

        const self = this;

        return self.getAppDefinitions()
            .then(function (allApps) {

                let app = allApps[appName];

                if (!app) {
                    throw new Error('App could not be found ' + appName);
                }

                app.customDomain = app.customDomain || [];

                if (app.customDomain.length > 0) {
                    for (let idx = 0; idx < app.customDomain.length; idx++) {
                        if (app.customDomain[idx].publicDomain === customDomain) {
                            app.customDomain[idx].hasSsl = true;
                            self.data.set(APP_DEFINITIONS + '.' + appName, app);
                            return true;
                        }
                    }
                }

                throw new Error('customDomain: ' + customDomain + ' is not attached to app ' + appName);

            });
    }

    removeCustomDomainForApp(appName, customDomain) {

        const self = this;

        return this.getAppDefinitions()
            .then(function (allApps) {

                let app = allApps[appName];

                if (!app) {
                    throw new Error('App could not be found ' + appName);
                }

                app.customDomain = app.customDomain || [];

                const newDomains = [];
                let removed = false;
                for (let idx = 0; idx < app.customDomain.length; idx++) {
                    if (app.customDomain[idx].publicDomain === customDomain) {
                        removed = true;
                    }
                    else {
                        newDomains.push(app.customDomain[idx]);
                    }
                }

                if (!removed) {
                    throw ApiStatusCodes.createError(ApiStatusCodes.STATUS_ERROR_GENERIC, 'Custom domain ' + customDomain + ' does not exist in ' + appName);
                }

                app.customDomain = newDomains;

                self.data.set(APP_DEFINITIONS + '.' + appName, app);

                return true;

            });
    }

    addCustomDomainForApp(appName, customDomain) {

        const self = this;

        return this.getAppDefinitions()
            .then(function (allApps) {

                let app = allApps[appName];

                if (!app) {
                    throw new Error('App could not be found ' + appName);
                }

                const rootDomain = self.getRootDomain();
                if (customDomain.endsWith('.' + rootDomain)) {
                    const possibleAppName = customDomain.slice(0, -rootDomain.length);
                    if (Object.keys(allApps).includes(possibleAppName)) {
                        throw new Error('app already exists: ' + possibleAppName);
                    }
                }

                Object.entries(allApps).forEach(([existingAppName, existingApp]) => {
                    (existingApp.customDomain || []).forEach(({publicDomain}) => {
                        if (publicDomain === customDomain) {
                            throw new Error('customDomain is already assigned: ' + customDomain + ' attached to app ' + existingAppName);
                        }
                    });
                });

                app.customDomain = app.customDomain || [];

                app.customDomain.push({
                    publicDomain: customDomain,
                    hasSsl: false
                });

                self.data.set(APP_DEFINITIONS + '.' + appName, app);

                return true;

            });
    }

    getServerList() {

        const self = this;

        let hasRootSsl = null;
        let rootDomain = null;

        return Promise.resolve()
            .then(function () {

                return self.getHasRootSsl();

            })
            .then(function (val) {

                hasRootSsl = val;

                return self.getRootDomain();

            })
            .then(function (val) {

                rootDomain = val;

            })
            .then(function () {

                return self.getDefaultAppNginxConfig();

            })
            .then(function (defaultAppNginxConfig) {

                let apps = self.data.get(APP_DEFINITIONS) || {};
                let servers = [];

                Object.keys(apps).forEach(function (appName) {

                    let webApp = apps[appName];

                    if (webApp.notExposeAsWebApp) {
                        return;
                    }

                    let localDomain = self.getServiceName(appName);
                    let forceSsl = !!webApp.forceSsl;
                    let nginxConfigTemplate = webApp.customNginxConfig || defaultAppNginxConfig;

                    let serverWithSubDomain = {};
                    serverWithSubDomain.hasSsl = hasRootSsl && webApp.hasDefaultSubDomainSsl;
                    serverWithSubDomain.publicDomain = appName === '@' ? rootDomain : appName + '.' + rootDomain;
                    serverWithSubDomain.localDomain = localDomain;
                    serverWithSubDomain.forceSsl = forceSsl;
                    serverWithSubDomain.nginxConfigTemplate = nginxConfigTemplate;

                    servers.push(serverWithSubDomain);

                    // adding custom domains
                    let customDomainArray = webApp.customDomain;
                    if (customDomainArray && customDomainArray.length > 0) {
                        for (let idx = 0; idx < customDomainArray.length; idx++) {
                            let d = customDomainArray[idx];
                            servers.push({
                                hasSsl: d.hasSsl,
                                forceSsl: forceSsl,
                                publicDomain: d.publicDomain,
                                localDomain: localDomain,
                                nginxConfigTemplate: nginxConfigTemplate
                            });

                        }
                    }


                });

                return servers;
            });
    }

    getAppDefinitions() {
        const self = this;
        return new Promise(function (resolve, reject) {

            resolve(self.data.get(APP_DEFINITIONS) || {});

        });
    }

    getAppDefinition(appName) {

        const self = this;

        return this.getAppDefinitions()
            .then(function (allApps) {

                if (!appName) {
                    throw new Error('App Name should not be empty');
                }

                let app = allApps[appName];

                if (!app) {
                    throw ApiStatusCodes.createError(ApiStatusCodes.STATUS_ERROR_GENERIC, ('App could not be found ' + appName));
                }

                return app;

            });
    }

    updateAppDefinitionInDb(appName, instanceCount, envVars, volumes, nodeId, notExposeAsWebApp, forceSsl, ports,
                            appPushWebhook, authenticator, customNginxConfig, preDeployFunction) {
        const self = this;

        let app;

        return Promise.resolve()
            .then(function () {

                return self.getAppDefinition(appName);

            })
            .then(function (appObj) {

                app = appObj;

            })
            .then(function () {

                if (appPushWebhook.repoInfo && appPushWebhook.repoInfo.repo && appPushWebhook.repoInfo.branch
                    && appPushWebhook.repoInfo.user && appPushWebhook.repoInfo.password) {
                    return authenticator
                        .getAppPushWebhookDatastore({
                            repo: appPushWebhook.repoInfo.repo,
                            branch: appPushWebhook.repoInfo.branch,
                            user: appPushWebhook.repoInfo.user,
                            password: appPushWebhook.repoInfo.password
                        })
                }

                return null;

            })
            .then(function (appPushWebhookRepoInfo) {

                instanceCount = Number(instanceCount);

                if (instanceCount >= 0) {
                    app.instanceCount = instanceCount;
                }


                app.notExposeAsWebApp = !!notExposeAsWebApp;
                app.forceSsl = !!forceSsl;
                app.nodeId = nodeId;
                app.customNginxConfig = customNginxConfig;
                app.preDeployFunction = preDeployFunction;

                if (app.forceSsl) {
                    let hasAtLeastOneSslDomain = app.hasDefaultSubDomainSsl;
                    let customDomainArray = app.customDomain;
                    if (customDomainArray && customDomainArray.length > 0) {
                        for (let idx = 0; idx < customDomainArray.length; idx++) {
                            if (customDomainArray[idx].hasSsl) {
                                hasAtLeastOneSslDomain = true;
                            }
                        }
                    }

                    if (!hasAtLeastOneSslDomain) {
                        throw new ApiStatusCodes.createError(ApiStatusCodes.ILLEGAL_OPERATION, "Cannot force SSL without any SSL-enabled domain!");
                    }

                }

                if (appPushWebhookRepoInfo) {

                    app.appPushWebhook = app.appPushWebhook || {};

                    if (!app.appPushWebhook.tokenVersion) {
                        app.appPushWebhook.tokenVersion = uuid();
                    }

                    app.appPushWebhook.repoInfo = appPushWebhookRepoInfo;
                }
                else {

                    app.appPushWebhook = {};

                }

                if (ports) {

                    function isPortValid(portNumber) {
                        return portNumber > 0 && portNumber < 65535;
                    }

                    let tempPorts = [];
                    for (let i = 0; i < ports.length; i++) {
                        let obj = ports[i];
                        if (obj.containerPort && obj.hostPort) {

                            let containerPort = Number(obj.containerPort);
                            let hostPort = Number(obj.hostPort);

                            if (isPortValid(containerPort) && isPortValid(hostPort)) {
                                tempPorts.push({
                                    hostPort: hostPort,
                                    containerPort: containerPort
                                });
                            }
                        }
                    }

                    app.ports = tempPorts;
                }

                if (envVars) {
                    app.envVars = [];
                    for (let i = 0; i < envVars.length; i++) {
                        let obj = envVars[i];
                        if (obj.key && obj.value) {
                            app.envVars.push({
                                key: obj.key,
                                value: obj.value
                            })
                        }
                    }
                }

                if (volumes) {

                    app.volumes = [];

                    for (let i = 0; i < volumes.length; i++) {
                        let obj = volumes[i];
                        if (obj.containerPath && (obj.volumeName || obj.hostPath)) {

                            if (obj.volumeName && obj.hostPath) {
                                throw new ApiStatusCodes.createError(ApiStatusCodes.STATUS_ERROR_GENERIC, "Cannot define both host path and volume name!");
                            }

                            if (!isValidPath(obj.containerPath)) {
                                throw new ApiStatusCodes.createError(ApiStatusCodes.STATUS_ERROR_GENERIC, "Invalid containerPath: " + obj.containerPath);
                            }

                            let newVol = {
                                containerPath: obj.containerPath
                            };

                            if (obj.hostPath) {

                                if (!isValidPath(obj.hostPath)) {
                                    throw new ApiStatusCodes.createError(ApiStatusCodes.STATUS_ERROR_GENERIC, "Invalid volume host path: " + obj.hostPath);
                                }

                                newVol.hostPath = obj.hostPath;
                                newVol.type = 'bind';

                            }
                            else {

                                if (!isNameAllowed(obj.volumeName)) {
                                    throw new ApiStatusCodes.createError(ApiStatusCodes.STATUS_ERROR_GENERIC, "Invalid volume name: " + obj.volumeName);
                                }

                                newVol.volumeName = obj.volumeName;
                                newVol.type = 'volume';

                            }

                            app.volumes.push(newVol);
                        }
                    }
                }

            })
            .then(function () {

                if (app.appPushWebhook.repoInfo) {
                    return authenticator
                        .getAppPushWebhookToken(appName, app.appPushWebhook.tokenVersion)
                }

            })
            .then(function (pushWebhookToken) {

                if (pushWebhookToken) {
                    app.appPushWebhook.pushWebhookToken = pushWebhookToken;
                }

                self.data.set(APP_DEFINITIONS + '.' + appName, app);

            });
    }

    setUserEmailAddress(emailAddress) {

        const self = this;

        return new Promise(function (resolve, reject) {

            self.data.set(EMAIL_ADDRESS, emailAddress);
            resolve();

        });

    }

    getUserEmailAddress() {

        const self = this;

        return new Promise(function (resolve, reject) {

            resolve(self.data.get(EMAIL_ADDRESS));

        });
    }

    setHasRootSsl(hasRootSsl) {

        const self = this;

        return new Promise(function (resolve, reject) {

            self.data.set(HAS_ROOT_SSL, hasRootSsl);
            resolve();

        });
    }

    setForceSsl(forceSsl) {
        const self = this;

        return new Promise(function (resolve, reject) {

            self.data.set(FORCE_ROOT_SSL, forceSsl);
            resolve();

        });
    }

    getForceSsl() {

        const self = this;

        return new Promise(function (resolve, reject) {

            resolve(self.data.get(FORCE_ROOT_SSL));

        });
    }

    setHasRegistrySsl(hasRegistrySsl) {

        const self = this;

        return new Promise(function (resolve, reject) {

            self.data.set(HAS_REGISTRY_SSL, hasRegistrySsl);
            resolve();

        });
    }

    getDefaultAppNginxConfig() {

        const self = this;

        return Promise.resolve()
            .then(function () {
                return DEFAULT_NGINX_CONFIG_FOR_APP;
            });
    }

    getNginxConfig() {

        const self = this;

        return Promise.resolve()
            .then(function () {
                return ({
                    baseConfig: {
                        byDefault: DEFAULT_NGINX_BASE_CONFIG,
                        customValue: self.data.get(NGINX_BASE_CONFIG)
                    },
                    captainConfig: {
                        byDefault: DEFAULT_NGINX_CAPTAIN_CONFIG,
                        customValue: self.data.get(NGINX_CAPTAIN_CONFIG)
                    }
                });
            });
    }

    setNginxConfig(baseConfig, captainConfig) {

        const self = this;

        return Promise.resolve()
            .then(function () {
                self.data.set(NGINX_BASE_CONFIG, baseConfig);
                self.data.set(NGINX_CAPTAIN_CONFIG, captainConfig);
            });
    }

    getHasRootSsl() {

        const self = this;

        return new Promise(function (resolve, reject) {

            resolve(self.data.get(HAS_ROOT_SSL));

        });
    }

    setHasLocalRegistry(hasLocalRegistry) {

        const self = this;

        return new Promise(function (resolve, reject) {

            self.data.set(HAS_LOCAL_REGISTRY, hasLocalRegistry);
            resolve();

        });
    }

    getHasLocalRegistry() {
        const self = this;
        return new Promise(function (resolve, reject) {
            resolve(self.data.get(HAS_LOCAL_REGISTRY));
        });
    }

    getHasRegistrySsl() {

        const self = this;

        return new Promise(function (resolve, reject) {

            resolve(self.data.get(HAS_REGISTRY_SSL));

        });
    }

    setCustomDomain(customDomain) {

        const self = this;

        return new Promise(function (resolve, reject) {

            self.data.set(CUSTOM_DOMAIN, customDomain);
            resolve();

        });
    }

    setDeployedVersion(appName, version) {

        if (!appName) {
            throw new Error('App Name should not be empty');
        }
        const self = this;

        return this.getAppDefinitions()
            .then(function (allApps) {

                let app = allApps[appName];

                if (!app) {
                    throw new Error('App could not be found ' + appName);
                }

                app.deployedVersion = version;

                self.data.set(APP_DEFINITIONS + '.' + appName, app);

                return version;

            });
    }

    setGitHash(appName, newVersion, gitHashToSave) {

        if (!appName) {
            throw new Error('App Name should not be empty');
        }

        const self = this;

        return this.getAppDefinition(appName)
            .then(function (app) {

                if (!app) {
                    throw new Error('App could not be found ' + appName);
                }

                app.versions = app.versions || [];


                for (let i = 0; i < app.versions.length; i++) {
                    if (app.versions[i].version === newVersion) {
                        app.versions[i].gitHash = gitHashToSave;
                        self.data.set(APP_DEFINITIONS + '.' + appName, app);
                        return;
                    }
                }

                Logger.e('Failed to set the git hash on the deployed version');


            });

    }

    getNewVersion(appName) {

        if (!appName) {
            throw new Error('App Name should not be empty');
        }
        const self = this;

        return this.getAppDefinitions()
            .then(function (allApps) {

                let app = allApps[appName];

                if (!app) {
                    throw new Error('App could not be found ' + appName);
                }

                let versions = app.versions;
                let newVersionIndex = versions.length;

                versions.push({
                    version: newVersionIndex,
                    gitHash: undefined,
                    timeStamp: new Date()
                });

                self.data.set(APP_DEFINITIONS + '.' + appName, app);

                return newVersionIndex;

            });
    }


    /**
     * Creates a new app definition.
     *
     * @param appName                   The appName you want to register
     * @param hasPersistentData         whether the app has persistent data, you can only run one instance of the app.
     * @returns {Promise}
     */
    registerAppDefinition(appName, hasPersistentData) {
        const self = this;

        return new Promise(function (resolve, reject) {

            if (!isAppNameAllowed(appName)) {
                reject(ApiStatusCodes.createError(ApiStatusCodes.STATUS_ERROR_BAD_NAME, 'App Name is not allowed. Only lowercase letters and single hyphen, or a single \'@\' is allowed.'));
                return;
            }

            const rootDomain = self.getRootDomain();
            const allApps = self.data.get(APP_DEFINITIONS);
            const availabilityError = checkNameAvailability(allApps, rootDomain, appName + '.' + rootDomain);
            if (availabilityError) {
                reject(availabilityError);
                return;
            }

            let defaultAppDefinition = {
                hasPersistentData: !!hasPersistentData,
                instanceCount: 1,
                networks: [CaptainConstants.captainNetworkName],
                envVars: [],
                volumes: [],
                ports: [],
                appPushWebhook: {}, // tokenVersion, repoInfo, pushWebhookToken
                versions: []
            };

            self.data.set(APP_DEFINITIONS + '.' + appName, defaultAppDefinition);
            resolve();

        });
    }

    deleteAppDefinition(appName) {
        const self = this;

        return new Promise(function (resolve, reject) {

            if (!isAppNameAllowed(appName)) {
                reject(ApiStatusCodes.createError(ApiStatusCodes.STATUS_ERROR_BAD_NAME, 'App Name is not allowed. Only lowercase letters and single hyphen, or a single \'@\' is allowed.'));
                return;
            }

            if (!self.data.get(APP_DEFINITIONS + '.' + appName)) {
                reject(ApiStatusCodes.createError(ApiStatusCodes.STATUS_ERROR_GENERIC, 'App Name does not exist in Database! Cannot be deleted.'));
                return;
            }

            self.data.delete(APP_DEFINITIONS + '.' + appName);
            resolve();

        });
    }

}

module.exports = DataStore;
