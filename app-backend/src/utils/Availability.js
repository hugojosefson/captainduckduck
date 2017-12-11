function checkForExistingApp(allApps, rootDomain, possibleAppName) {
    if (Object.keys(allApps).includes(possibleAppName)) {
        return ApiStatusCodes.createError(
            ApiStatusCodes.STATUS_ERROR_ALREADY_EXIST,
            'Can\'t add customDomain, because app with that name already exists: ' + possibleAppName
        );
    }

    return undefined;
}

function checkForExistingCustomDomain(allApps, customDomain) {
    return Object.entries(allApps)
        .map(([existingAppName, existingApp]) => {
            return (existingApp.customDomain || [])
                .map(({publicDomain}) => {
                    if (publicDomain === customDomain) {
                        return ApiStatusCodes.createError(
                            ApiStatusCodes.STATUS_ERROR_ALREADY_EXIST,
                            'Can\'t add customDomain, because it\'s already attached to app ' + existingAppName
                        );
                    }

                    return undefined;
                })
                .filter(a => a)[0];
        })
        .filter(a => a)[0];
}

function checkNameAvailability(allApps, rootDomain, customDomain) {
    if (customDomain === rootDomain) {
        const apexAppError = checkForExistingApp(allApps, rootDomain, '@');
        if (apexAppError) return apexAppError;
    }

    if (customDomain.endsWith('.' + rootDomain)) {
        const possibleAppName = customDomain.slice(0, -rootDomain.length);
        const existingAppError = checkForExistingApp(allApps, rootDomain, possibleAppName);
        if (existingAppError) return existingAppError;
    }

    return checkForExistingCustomDomain(allApps, customDomain);
}

module.exports = {checkNameAvailability};