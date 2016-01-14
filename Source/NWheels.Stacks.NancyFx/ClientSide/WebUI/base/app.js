'use strict';

var theApp = angular.module('theApp', []);

//-----------------------------------------------------------------------------------------------------------------

function toCamelCase(s) {
    return s.charAt(0).toLowerCase() + s.slice(1);
}

//-----------------------------------------------------------------------------------------------------------------

theApp.factory('appHttpInterceptor', ['$rootScope', '$q', 'sessionService', function ($rootScope, $q, sessionService) {
    return {
        'response': function(response) {
            sessionService.slideExpiry();
            return response;
        },
        'responseError': function(rejection) {
            if (rejection.status===0) {
                sessionService.deactivateExpiry();
                $rootScope.$broadcast($rootScope.app.qualifiedName + ':ServerConnectionLost');
            } else {
                sessionService.slideExpiry();
            }
            return $q.reject(rejection);
        }
    };
}]);

//-----------------------------------------------------------------------------------------------------------------

theApp.config(['$httpProvider', function($httpProvider) {
    $httpProvider.interceptors.push('appHttpInterceptor');
}]);

//---------------------------------------------------------------------------------------------------------------------

theApp.service('commandService',
['$http', '$q', '$interval', '$timeout', '$rootScope',
function ($http, $q, $interval, $timeout, $rootScope) {

    var m_pendingCommands = {};
    var m_pollTimer = null;

    //-----------------------------------------------------------------------------------------------------------------

    function sendCommand(callType, requestPath, requestData) {
        var commandCompletion = $q.defer();

        $http.post(requestPath, requestData).then(
            function (response) {
                if (callType === 'OneWay') {
                    commandCompletion.resolve({ success: true });
                } else {
                    var resultMessage = response.data;
                    //m_pendingCommands[response.data.commandMessageId] = commandCompletion;
                    if (resultMessage.success === true) {
                        commandCompletion.resolve(resultMessage.result);
                    } else {
                        commandCompletion.reject(resultMessage);
                    }
                }
            },
            function (response) {
                var faultInfo = createFaultInfo(response);
                commandCompletion.reject(faultInfo);
            }
        );

        return commandCompletion.promise;
    }

    //-----------------------------------------------------------------------------------------------------------------

    function receiveMessages() {
        $http.post('takeMessages').then(
            function (response) {
                for (var i = 0 ; i < response.data.length ; i++) {
                    var message = response.data[i];
                    if (message.type === 'Commands.CommandResultMessage') {
                        var commandCompletion = m_pendingCommands[message.commandMessageId];
                        if (commandCompletion) {
                            if (message.success === true) {
                                commandCompletion.resolve(message.result);
                            } else {
                                commandCompletion.reject(message);
                            }
                            delete m_pendingCommands[message.commandMessageId];
                        }
                    }
                    //TODO: dispatch received push messages other than command completions
                }
            },
            function (response) {
                //TODO: alert user there is a connectivity problem with the server
            }
        );
    }

    //-----------------------------------------------------------------------------------------------------------------

    function startPollingMessages() {
        if (!m_pollTimer) {
            m_pollTimer = $interval(receiveMessages, 2000);
        }
    }

    //-----------------------------------------------------------------------------------------------------------------

    function stopPollingMessages() {
        if (m_pollTimer) {
            $interval.cancel(m_pollTimer);
            m_pollTimer = null;
        }
    }

    //-----------------------------------------------------------------------------------------------------------------
    
    function createFaultInfo(httpResponse) {
        if (httpResponse.data && httpResponse.data.faultCode) {
            return httpResponse.data;
        }
        var faultInfo = {
            success: false,
            Success: false,
            faultCode: httpResponse.status,
            FaultCode: httpResponse.status,
            faultReason: httpResponse.statusText,
            FaultReason: httpResponse.statusText,
            technicalInfo: httpResponse.data,
            TechnicalInfo: httpResponse.data
        };
        return faultInfo;
    }

    //-----------------------------------------------------------------------------------------------------------------

    return {
        sendCommand: sendCommand,
        receiveMessages: receiveMessages,
        startPollingMessages: startPollingMessages,
        stopPollingMessages: stopPollingMessages,
        createFaultInfo: createFaultInfo
    };
}]);

//---------------------------------------------------------------------------------------------------------------------

theApp.service('sessionService',
['$timeout', '$rootScope',
function ($timeout, $rootScope) {

    var m_sessionTimeout = null;
    var m_expiryMilliseconds = -1;
    var m_expiredNotificationId = null;
    
    //-----------------------------------------------------------------------------------------------------------------

    function activateExpiry(expiryMilliseconds, expiredNotificationId) {
        if (m_sessionTimeout) {
            $timeout.cancel(m_sessionTimeout);
        }
        m_expiryMilliseconds = expiryMilliseconds;
        m_expiredNotificationId = expiredNotificationId;
        m_sessionTimeout = $timeout(notifySessionExpired, expiryMilliseconds);
    };
    
    //-----------------------------------------------------------------------------------------------------------------

    function slideExpiry() {
        if (m_sessionTimeout) {
            $timeout.cancel(m_sessionTimeout);
            m_sessionTimeout = $timeout(notifySessionExpired, m_expiryMilliseconds);
        }
    };

    //-----------------------------------------------------------------------------------------------------------------

    function deactivateExpiry() {
        if (m_sessionTimeout) {
            $timeout.cancel(m_sessionTimeout);
        }
        m_sessionTimeout = null;
    };
    
    //-----------------------------------------------------------------------------------------------------------------

    function notifySessionExpired() {
        deactivateExpiry();
        $rootScope.$broadcast(m_expiredNotificationId);
    }

    //-----------------------------------------------------------------------------------------------------------------

    return {
        activateExpiry: activateExpiry,
        slideExpiry: slideExpiry,
        deactivateExpiry: deactivateExpiry
    };
}]);

//---------------------------------------------------------------------------------------------------------------------

theApp.service('uidlService',
['$q', '$http', '$rootScope', '$timeout', '$templateCache', 'commandService', 'sessionService',
function ($q, $http, $rootScope, $timeout, $templateCache, commandService, sessionService) {

    var m_uidl = null;
    var m_app = null;
    var m_index = {
        screens: {},
        screenParts: {},
    };
    var m_currentScreen = null;
    var m_behaviorImplementations = {};
    var m_dataBindingImplementations = {};
    var m_controllerImplementations = {};

    //var m_pendingCommands = { };

    //-----------------------------------------------------------------------------------------------------------------

    function setDocument(uidlDocument) {
        m_uidl = uidlDocument;
        m_app = m_uidl.applications[0];

        for (var i = 0; i < m_app.screens.length; i++) {
            m_index.screens[m_app.screens[i].qualifiedName] = m_app.screens[i];
        }

        for (var i = 0; i < m_app.screenParts.length; i++) {
            m_index.screenParts[m_app.screenParts[i].qualifiedName] = m_app.screenParts[i];
        }

        m_currentScreen = m_index.screens[m_app.initialScreenQualifiedName];
    }

    //-----------------------------------------------------------------------------------------------------------------

    function translate(stringId, options) {
        if (!stringId) {
            return '';
        }
        var localizedString = getCurrentLocale().translations[toCamelCase(stringId)] || stringId;
        //if (localizedString) {
        //    return localizedString;
        //}
        
        if (options && options.upperCase === true) {
            localizedString = localizedString.toUpperCase();
        }
        
        return localizedString;
    }

    //-----------------------------------------------------------------------------------------------------------------
    /*
    function executeNotification(scope, notification, direction) {
        if (direction.indexOf('BubbleUp') > -1) {
            scope.$emit(notification.qualifiedName);
        }
        if (direction.indexOf('TunnelDown') > -1) {
            scope.$broadcast(notification.qualifiedName);
        }
    };
    */
    //-----------------------------------------------------------------------------------------------------------------
    /*
    function executeBehavior(scope, behavior, eventArgs) {
        switch(behavior.behaviorType) {
            case 'Navigate':
                return $q(function(resolve, reject) {
                    switch(behavior.targetType) {
                        case 'Screen':
                            var screen = m_index.screens[toCamelCase(targetQualifiedName)];
                            $rootScope.currentScreen = screen;
                            break;
                        case 'ScreenPart':
                            var screenPart = m_index.screenParts[toCamelCase(targetQualifiedName)];
                            $rootScope.$broadcast(behavior.containerQualifiedName + '.NavReq', screenPart);
                            break;
                    }
                    resolve(eventArgs);
                });
            case 'InvokeCommand':
                return $q(function(resolve, reject) {
                    $rootScope.$broadcast(behavior.commandQualifiedName + '_Executing');
                    resolve(eventArgs);
                });
            case 'Broadcast':
                return $q(function(resolve, reject) {
                    if (behavior.direction.indexOf('BubbleUp') > -1) {
                        scope.$emit(behavior.notificationQualifiedName);
                    }
                    if (behavior.direction.indexOf('TunnelDown') > -1) {
                        scope.$broadcast(behavior.notificationQualifiedName);
                    }
                    resolve(eventArgs);
                });
            case 'CallApi':
                return $http.post('api/' + behavior.contractName + '/' + behavior.operationName);
        }
    };
    */
    //-----------------------------------------------------------------------------------------------------------------

    function implementBehavior(scope, behavior, input) {
        var impl = m_behaviorImplementations[behavior.behaviorType];
        var implResult = impl.execute(scope, behavior, input);
        var promise = null;

        if (impl.returnsPromise) {
            promise = implResult;
        }
        else {
            promise = $q(function (resolve, reject) {
                resolve(input);
            });
        }

        promise.then(
            function (result) {
                if (behavior.onSuccess) {
                    implementBehavior(scope, behavior.onSuccess, result);
                }
            },
            function (error) {
                if (behavior.onFailure) {
                    implementBehavior(scope, behavior.onFailure, error);
                }
            });
    }

    //-----------------------------------------------------------------------------------------------------------------

    function implementSubscription(scope, behavior) {
        scope.$on(behavior.subscription.notificationQualifiedName, function (event, input) {
            console.log('uidlService::on-behavior', behavior.qualifiedName);
            implementBehavior(scope, behavior, input);
        });
    }

    //-----------------------------------------------------------------------------------------------------------------
    
    function implementDataBinding(scope, binding) {
        var impl = m_dataBindingImplementations[binding.sourceType];
        impl.execute(scope, binding);
    }

    //-----------------------------------------------------------------------------------------------------------------

    function implementController(scope) {
        scope.translate = translate;
        scope.appScope = $rootScope.appScope;
        scope.model = {
            Data: {},
            State: {}
        };
        if (scope.appScope.model) {
            scope.model.appState = scope.appScope.model.State;
        }

        if (scope.uidl) {
            console.log('uidlService::implementController', scope.uidl.qualifiedName);

            if (scope.uidl.widgetType && m_controllerImplementations[scope.uidl.widgetType]) {
                m_controllerImplementations[scope.uidl.widgetType].implement(scope);
            }

            for (var i = 0; i < scope.uidl.behaviors.length; i++) {
                var behavior = scope.uidl.behaviors[i];
                if (behavior.subscription) {
                    implementSubscription(scope, behavior);
                }
            }

            for (var i = 0; i < scope.uidl.dataBindings.length; i++) {
                implementDataBinding(scope, scope.uidl.dataBindings[i]);
            }
        }
    }

    //-----------------------------------------------------------------------------------------------------------------

    function getApp() {
        return m_app;
    }

    //-----------------------------------------------------------------------------------------------------------------

    function getCurrentScreen() {
        return m_currentScreen;
    }

    //-----------------------------------------------------------------------------------------------------------------

    function getCurrentLocale() {
        return m_uidl.locales['en-US'];
    }

    //-----------------------------------------------------------------------------------------------------------------

    function getMetaType(name) {
        return m_uidl.metaTypes[toCamelCase(name)];
    }

    //-----------------------------------------------------------------------------------------------------------------

	function getRelatedMetaType(entityName, propertyName) {
        var fromMetaType = m_uidl.metaTypes[toCamelCase(entityName)];
		var fromMetaProperty = fromMetaType.properties[toCamelCase(propertyName)];
		
		if (fromMetaProperty.relation && fromMetaProperty.relation.relatedPartyMetaTypeName) {
			return m_uidl.metaTypes[toCamelCase(fromMetaProperty.relation.relatedPartyMetaTypeName)];
		}
		else {
			return null;
		}
	};

    //-----------------------------------------------------------------------------------------------------------------

    function loadTemplateById(templateId) {
        var fullTemplateId = 'uidl-element-template/' + templateId;
        var template = $templateCache.get(fullTemplateId);

        if (template) {
            return $q.when(template);
        } else {
            var deferred = $q.defer();

            $http.get(fullTemplateId, { cache: true }).then(
                function (response) {
                    $templateCache.put(fullTemplateId, response.data);
                    deferred.resolve(response.data);
                },
                function (error) {
                    deferred.reject(error);
                }
            );

            return deferred.promise;
        }
    }

    //-----------------------------------------------------------------------------------------------------------------

    function selectValue(context, expression) {
        return Enumerable.Return(context).Select('ctx=>ctx.' + expression).Single();
    };
    
    //-----------------------------------------------------------------------------------------------------------------
    
    /*
        function takeMessagesFromServer() {
            $http.post('takeMessages').then(
                function(response) {
                    for ( var i = 0 ; i < response.data.length ; i++ )
                    {
                        var message = response.data[i];
                        if (message.type==='Commands.CommandResultMessage') {
                            var commandCompletion = m_pendingCommands[message.commandMessageId];
                            if (commandCompletion) {
                                if (message.success === true) {
                                    commandCompletion.resolve(message.result);
                                } else {
                                    commandCompletion.reject(message);
                                }
                                delete m_pendingCommands[message.commandMessageId];
                            }
                        }
                        //TODO: dispatch received push messages other than command completions
                    }
                },
                function(response) {
                    //TODO: alert user there is a connectivity problem with the server
                }
            );
        }
    */
    //-----------------------------------------------------------------------------------------------------------------

    m_behaviorImplementations['Navigate'] = {
        returnsPromise: false,
        execute: function (scope, behavior, input) {
            console.log('run-behavior > navigate', behavior.targetType, behavior.targetQualifiedName);
            switch (behavior.targetType) {
                case 'Screen':
                    var screen = m_index.screens[behavior.targetQualifiedName];
                    $rootScope.currentScreen = null;
                    $timeout(function() {
                        $rootScope.currentScreen = screen;
                        location.hash = screen.qualifiedName;
                        $timeout(function() {
                            //if (oldScreen) {
                            //    $rootScope.$broadcast(oldScreen.qualifiedName + ':NavigatingAway', input);
                            //}
                            $rootScope.$broadcast(screen.qualifiedName + ':NavigatedHere', input);
                        });
                    });
                    break;
                case 'ScreenPart':
                    var screenPart = m_index.screenParts[behavior.targetQualifiedName];
                    $rootScope.$broadcast(behavior.targetContainerQualifiedName + ':NavReq', {
                        screenPart: screenPart,
                        input: input
                    });
                    break;
            }
        },
    };

    //-----------------------------------------------------------------------------------------------------------------

    m_behaviorImplementations['InvokeCommand'] = {
        returnsPromise: false,
        execute: function (scope, behavior, input) {
            console.log('run-behavior > invokeCommand', behavior.commandQualifiedName);
            if (scope.$parent) {
                scope.$parent.$emit(behavior.commandQualifiedName + ':Executing', input);
            }
            scope.$broadcast(behavior.commandQualifiedName + ':Executing', input);
        },
    };

    //-----------------------------------------------------------------------------------------------------------------

    m_behaviorImplementations['Broadcast'] = {
        returnsPromise: false,
        execute: function (scope, behavior, input) {
            console.log('run-behavior > broadcast', behavior.notificationQualifiedName, behavior.direction);
            if (behavior.direction.indexOf('BubbleUp') > -1) {
                scope.$emit(behavior.notificationQualifiedName, input);
            }
            if (behavior.direction.indexOf('TunnelDown') > -1) {
                scope.$broadcast(behavior.notificationQualifiedName, input);
            }
        },
    };

    //-----------------------------------------------------------------------------------------------------------------

    m_behaviorImplementations['CallApi'] = {
        returnsPromise: true,
        execute: function (scope, behavior, input) {
            console.log('run-behavior > callApi', behavior.callTargetType, behavior.contractName, behavior.operationName);
            var requestData = {};
            var parameterContext = {
                Data: scope.model.Data,
                State: scope.model.State,
                Input: input
            };
            for (var i = 0; i < behavior.parameterNames.length; i++) {
                var parameterValue = (
                    behavior.parameterExpressions[i] && behavior.parameterExpressions[i].length > 0 ?
                    Enumerable.Return(parameterContext).Select('ctx=>ctx.' + behavior.parameterExpressions[i]).Single() :
                    null);
                requestData[behavior.parameterNames[i]] = parameterValue;
            }
            var requestPath = 
                'api' + 
                '/' + behavior.callType +
                '/' + behavior.callResultType +
                (behavior.callResultType==='EntityQuery' || behavior.callResultType==='EntityQueryExport' ? '/' + behavior.queryEntityName : '') +
                '/' + behavior.callTargetType + 
                '/' + behavior.contractName + 
                '/' + behavior.operationName;
            
            if (behavior.callResultType === 'EntityQueryExport') {
                requestPath += '/' + behavior.exportFormatId;
            }
            if (behavior.callTargetType === 'EntityMethod') {
                requestPath += '?$entityId=' + encodeURIComponent(scope.model.State.entity['$id']);
            }
            if (behavior.querySelectList || behavior.queryIncludeList) {
                var queryBuilder = new EntityQueryBuilder(behavior.queryEntityName, requestPath);
                if (behavior.querySelectList) {
                    for (var i = 0; i < behavior.querySelectList.length; i++) {
                        queryBuilder.select(behavior.querySelectList[i]);
                    }
                }
                if (behavior.queryIncludeList) {
                    for (var i = 0; i < behavior.queryIncludeList.length; i++) {
                        queryBuilder.include(behavior.queryIncludeList[i]);
                    }
                }
                requestPath += queryBuilder.getQueryString();
            }
            if (behavior.prepareOnly===true) {
                return $q.when({
                    url: requestPath,
                    data: requestData
                });
            }
             
            return commandService.sendCommand(behavior.callType, requestPath, requestData);
        },
    };

    //-----------------------------------------------------------------------------------------------------------------

    m_behaviorImplementations['AlertUser'] = {
        returnsPromise: true,
        execute: function (scope, behavior, input) {
            console.log('run-behavior > alertUser');
            var uidlAlert = m_app.userAlerts[toCamelCase(behavior.alertQualifiedName)];
            var deferred = $q.defer(); 
            var alertHandle = {
                uidl: uidlAlert,
                parameters: { },
                faultInfo: null,
                answer: function(choice) {
                    return deferred.resolve(choice);
                }
            };
            var context = {
                model: {
                    Input: input,
                    Data: scope.model.Data,
                    State: scope.model.State
                }
            };
            var contextAsEnumerable = Enumerable.Return(context);
            for (var i = 0; i < behavior.parameterExpressions.length ; i++) {
                alertHandle.parameters[uidlAlert.parameterNames[i]] = contextAsEnumerable.Select('ctx=>ctx.' + behavior.parameterExpressions[i]).Single();
            }
            if (behavior.faultInfoExpression) {
                alertHandle.faultInfo = contextAsEnumerable.Select('ctx=>ctx.' + behavior.faultInfoExpression).Single();
                $rootScope.userAlertTechnicalInfo = JSON.stringify(alertHandle.faultInfo, null, 4);
            } else {
                $rootScope.userAlertTechnicalInfo = null;
            }
            switch (behavior.displayMode) {
                case 'Inline':
                    scope.inlineUserAlert.current = alertHandle;
                    break;
                case 'Popup':
                    $rootScope.showPopupAlert(alertHandle);
                    break;
                case 'Modal':
                    $rootScope.$broadcast(m_app.modalAlert.qualifiedName + ':Show', alertHandle);
                    break;
            }
            if (uidlAlert.resultChoices.length) {
                return deferred.promise;
            } else {
                return $q.when(true);
            }
        }
    };

    //-----------------------------------------------------------------------------------------------------------------

    m_behaviorImplementations['AlterModel'] = {
        returnsPromise: false,
        execute: function (scope, behavior, input) {
            scope.model.Input = input;
            var context = {
                model: scope.model
            };
            for (var i = 0; i < behavior.alterations.length; i++) {
                var alteration = behavior.alterations[i];
                switch (alteration.type) {
                    case 'Copy':
                        var value = (
                            alteration.sourceExpression==='null' || !alteration.sourceExpression
                            ? null
                            : Enumerable.Return(context).Select('ctx=>ctx.' + alteration.sourceExpression).Single());
                        var target = context;
                        for (var j = 0; j < alteration.destinationNavigations.length - 1; j++) {
                            target = target[alteration.destinationNavigations[j]];
                        }
                        var lastNavigation = alteration.destinationNavigations[alteration.destinationNavigations.length-1];
                        target[lastNavigation] = value;
                        break;
                }
            }
        },
    };

    //-----------------------------------------------------------------------------------------------------------------

    m_behaviorImplementations['QueryModel'] = {
        returnsPromise: true,
        execute: function (scope, behavior, input) {
            scope.model.Input = input;
            var context = {
                model: scope.model
            };
            
            var value = (
                behavior.sourceExpression==='null' || !behavior.sourceExpression
                ? behavior.constantValue
                : Enumerable.Return(context).Select('ctx=>ctx.' + behavior.sourceExpression).Single());
            return $q.when(value);
        },
    };

    //-----------------------------------------------------------------------------------------------------------------

    m_behaviorImplementations['ActivateSessionTimeout'] = {
        returnsPromise: false,
        execute: function (scope, behavior, input) {
            var timeoutMinutes = 0;
            if (behavior.idleMinutesExpression) {
                scope.model.Input = input;
                var context = {
                    model: scope.model
                };
                timeoutMinutes = Enumerable.Return(context).Select('ctx=>ctx.' + behavior.idleMinutesExpression).Single();
            } else {
                timeoutMinutes = m_app.sessionIdleTimeoutMinutes;
            }
            var timeoutMs = (timeoutMinutes * 60000) - 10000;
            sessionService.activateExpiry(timeoutMs, scope.appScope.uidl.qualifiedName + ':UserSessionExpired');
        },
    };

    //-----------------------------------------------------------------------------------------------------------------

    m_behaviorImplementations['DeactivateSessionTimeout'] = {
        returnsPromise: false,
        execute: function (scope, behavior, input) {
            sessionService.deactivateExpiry();
        },
    };

    //-----------------------------------------------------------------------------------------------------------------

    m_behaviorImplementations['RestartApp'] = {
        returnsPromise: false,
        execute: function (scope, behavior, input) {
            window.location.reload();
        },
    };

    //-----------------------------------------------------------------------------------------------------------------

    m_behaviorImplementations['DownloadContent'] = {
        returnsPromise: false,
        execute: function (scope, behavior, input) {
            scope.model.Input = input;
            var context = {
                model: scope.model
            };
            var contentId = Enumerable.Return(context).Select('ctx=>ctx.' + behavior.contentIdExpression).Single();
            $rootScope.beginBrowserDownload('downloadContent/' + contentId);
        },
    };

    //-----------------------------------------------------------------------------------------------------------------

    m_dataBindingImplementations['AppState'] = {
        execute: function(scope, binding) {
            try {
                var initialValue = readValueFromSource();
                writeValueToDestination(initialValue);
            }
            catch(err) {
            }            
            
            scope.$watch('model.' + binding.sourceExpression, function(newValue, oldValue) {
                writeValueToDestination(newValue);
            });
        
            function readValueFromSource() {
                var context = {
                    appState: scope.model.appState
                };
                var value = Enumerable.Return(context).Select('ctx=>ctx.' + binding.sourceExpression).Single();
                return value;
            }
            
            function writeValueToDestination(value) {
                var target = scope;
                for (var i = 0; i < binding.destinationNavigations.length - 1; i++) {
                    target = target[binding.destinationNavigations[i]];
                }
                var lastNavigation = binding.destinationNavigations[binding.destinationNavigations.length-1];
                target[lastNavigation] = value;
            }
        }
    };
    
    //-----------------------------------------------------------------------------------------------------------------

    m_controllerImplementations['ScreenPartContainer'] = {
        implement: function (scope) {
            scope.$on(scope.uidl.qualifiedName + ':NavReq', function (event, data) {
                console.log('screenPartContainer::on-NavReq', scope.uidl.qualifiedName, '->', data.screenPart.qualifiedName);
                scope.currentScreenPart = null;
                $timeout(function() {
                    scope.currentScreenPart = data.screenPart;
                    location.hash = data.screenPart.qualifiedName;
                    $timeout(function() {
                        scope.$broadcast(data.screenPart.qualifiedName + ':NavigatedHere', data.input);
                        if (data.screenPart.contentRoot) {
                            scope.$broadcast(data.screenPart.contentRoot.qualifiedName + ':NavigatedHere', data.input);
                        }
                        $rootScope.$broadcast(scope.uidl.qualifiedName + ':ScreenPartLoaded', scope.currentScreenPart);
                        //if (oldScreenPart) {
                        //    $rootScope.$broadcast(oldScreenPart.qualifiedName + ':NavigatingAway', data.input);
                        //}
                    });
                });
            });
            if (scope.uidl.initalScreenPartQualifiedName) {
                scope.currentScreenPart = m_index.screenParts[scope.uidl.initalScreenPartQualifiedName];
                $timeout(function() {
                    scope.$broadcast(scope.uidl.initalScreenPartQualifiedName + ':NavigatedHere');
                    $rootScope.$broadcast(scope.uidl.qualifiedName + ':ScreenPartLoaded', scope.currentScreenPart);
                });
            }
        },
    };

    //-----------------------------------------------------------------------------------------------------------------

    m_controllerImplementations['ModalUserAlert'] = {
        implement: function (scope) {
            scope.$on(scope.uidl.qualifiedName + ':Show', function(event, data) {
                scope.alert = data;
                scope.$broadcast(scope.uidl.qualifiedName + ':ShowModal');
            });
            
            scope.answerAlert = function(choice) {
                scope.$broadcast(scope.uidl.qualifiedName + ':HideModal');
                scope.alert.answer(choice);
                scope.alert = null;
            }
        }
    };
    
    //-----------------------------------------------------------------------------------------------------------------

    m_controllerImplementations['ManagementConsole'] = {
        implement: function (scope) {
            function implementMenuItems(items) {
                for (var i = 0; i < items.length; i++) {
                    var item = items[i];
                    for (var j = 0; j < item.behaviors.length; j++) {
                        var behavior = item.behaviors[j];
                        if (behavior.subscription) {
                            implementSubscription(scope, behavior);
                        }
                    }
                    implementMenuItems(item.subItems);
                }
            }

            implementMenuItems(scope.uidl.mainMenu.items);

            if (window.appInit) {
			    window.appInit();
            }

            scope.$on(scope.uidl.qualifiedName + ':MainContent:ScreenPartLoaded', function (event, data) {
                scope.mainContentScreenPart = data;
            });
        },
    };

    //-----------------------------------------------------------------------------------------------------------------

    m_controllerImplementations['Report'] = {
        implement: function (scope) {
            scope.model.State.criteria = {};
            scope.model.State.reportInProgress = false;
            
            $timeout(function() {
                scope.$broadcast(scope.uidl.qualifiedName + ':CriteriaForm:ModelSetter', scope.model.State.criteria);
            });

            scope.$on(scope.uidl.qualifiedName + ':ShowReport:Executing', function(event, data) {
                scope.model.State.reportInProgress = true;
            });
            scope.$on(scope.uidl.resultTable.qualifiedName + ':QueryCompleted', function(event, data) {
                if (scope.model.State.reportInProgress===true) {
                    scope.model.State.reportInProgress = false;
                    scope.$emit(scope.uidl.qualifiedName + ':ReportReady', data);
                }
            });
            scope.$on(scope.uidl.resultTable.qualifiedName + ':QueryFailed', function(event, data) {
                if (scope.model.State.reportInProgress===true) {
                    scope.$emit(scope.uidl.qualifiedName + ':ReportFailed', data);
                }
                scope.model.State.reportInProgress = false;
            });
        }
    };

    //-----------------------------------------------------------------------------------------------------------------

    m_controllerImplementations['ChartReport'] = {
        implement: function (scope) {
            scope.model.State.criteria = {};

            $timeout(function () {
                scope.$broadcast(scope.uidl.qualifiedName + ':CriteriaForm:ModelSetter', scope.model.State.criteria);
            });
        }
    };

    //-----------------------------------------------------------------------------------------------------------------

	m_controllerImplementations['Chart'] = {
        implement: function(scope) {
            scope.invokeCommand = function(command, item) {
                for (var i = 0; i < command.items.length; i++) {
                    command.items[i].isChecked = (command.items[i].value === item.value);
                }
                scope.$emit(command.qualifiedName + ':Executing', item.value);
                $rootScope.$broadcast(':global:CommandCheckChanged', command);
            }

			scope.$on(':global:CommandCheckChanged', function (event, data) {
			    var command = Enumerable.From(scope.uidl.commands).FirstOrDefault('c=>c.qualifiedName=="' + data.qualifiedName + '"');
                if (command) {
                    for (var i = 0; i < command.items.length; i++) {
                        command.items[i].isChecked = data.items[i].isChecked;
                    }
                }
			});

			scope.$on(scope.uidl.modelSetterQualifiedName, function (event, data) {
			    scope.model.State.data = scope.uidlService.selectValue(data, scope.uidl.dataExpression);
			});
        }
    };

    //-----------------------------------------------------------------------------------------------------------------

    m_controllerImplementations['Gauge'] = {
        implement: function (scope) {
			scope.$on(scope.uidl.modelSetterQualifiedName, function (event, data) {
                var valueContext = {
                    Input: data
                };
                var gaugeValues = [];
                
                for(var i = 0; i < scope.uidl.values.length; i++) {
                    var valueUidl = scope.uidl.values[i];
                    gaugeValues.push({
                        title: valueUidl.title,
                        value: scope.uidlService.selectValue(valueContext, valueUidl.valueProperty),
                        alertType: valueUidl.alertType,
                        alertText: valueUidl.alertText
                    });
                }
                
                scope.model.State.values = gaugeValues;
			});

            scope.$on(scope.uidl.updateSourceQualifiedName, function(event, data) {
                scope.model.State.data = data;
            });
        }
    };

    //-----------------------------------------------------------------------------------------------------------------

    m_controllerImplementations['Crud'] = {
        implement: function (scope) {
            if (scope.uidl.formTypeSelector !== null && scope.uidl.formTypeSelector.selections.length === 1) {
                scope.uidl.entityName = scope.uidl.formTypeSelector.selections[0].widget.entityName;
                scope.uidl.form = scope.uidl.formTypeSelector.selections[0].widget;
                scope.uidl.formTypeSelector = null;
            }

            var metaType = scope.uidlService.getMetaType(scope.uidl.entityName);
            scope.metaType = metaType;
            scope.commandInProgress = false;
            scope.entityAuth = null;

            scope.refresh = function () {
                scope.resetCrudState();
                scope.requestAuthorization();
                scope.queryEntities();
            };

            scope.requestAuthorization = function () {
                scope.entityService.checkAuthorization(scope.uidl.grid.entityName).then(
                    function(response) {
                        scope.entityAuth = response;
                    },
                    function(fault) {
                        scope.entityAuth = null;
                        scope.$emit(scope.uidl.qualifiedName + ':QueryEntityFailed', commandService.createFaultInfo(fault));
                    }
                );
            }
            
            scope.queryEntities = function () {
                scope.selectedEntity = null;
                scope.commandInProgress = true;
                
                if (scope.uidl.mode !== 'Inline') {
                    scope.resultSet = null;
                    var query = scope.entityService.newQueryBuilder(scope.uidl.entityName);
                    
                    if (scope.uidl.entityTypeFilter) {
                        query.ofType(scope.uidl.entityTypeFilter);
                    }
                    
                    var preparedRequest = {
                        query: query,
                        data: { }
                    };
                    
                    scope.$broadcast(scope.uidl.grid.qualifiedName + ':RequestPrepared', preparedRequest);
                } else {
                    $timeout(function() {
                        scope.commandInProgress = false;
                        scope.$broadcast(scope.uidl.qualifiedName + ':Grid:DataReceived', scope.resultSet);
                    });
                }
            };

            scope.resetCrudState = function() {
                scope.uiShowCrudForm = false;
                scope.selectedEntity = null;
                scope.entity = null;
                scope.commandInProgress = false;
            };

            scope.$on(scope.uidl.grid.qualifiedName + ':QueryCompleted', function (event, data) {
                scope.resultSet = data;
                scope.commandInProgress = false;
            });

            scope.$on(scope.uidl.qualifiedName + ':NavigatedHere', function (event) {
                scope.refresh();
            });

            scope.$on(scope.uidl.qualifiedName + ':Grid:ObjectSelected', function(event, data) {
                scope.$apply(function() {
                    scope.selectedEntity = data;
                });
            });

            scope.$on(scope.uidl.qualifiedName + ':Grid:ObjectSelectedById', function (event, id) {
                scope.$apply(function() {
                    scope.selectedEntity = Enumerable.From(scope.resultSet).Where("$.$id == '" + id + "'").First();
                });
            });

            scope.$on(scope.uidl.qualifiedName + ':Grid:ObjectSelectedByIndex', function (event, index) {
                scope.$apply(function() {
                    scope.selectedEntity = scope.resultSet[index];
                });
            });

            scope.editEntity = function (entity) {
                if (!entity) {
                    return;
                }

                scope.model.entity = entity;
                scope.model.isNew = false;

                if (scope.uidl.formTypeSelector) {
                    scope.$broadcast(scope.uidl.formTypeSelector.qualifiedName + ':ModelSetter', scope.model.entity);
                } else {
                    scope.$broadcast(scope.uidl.form.qualifiedName + ':ModelSetter', scope.model.entity);
                }

                $timeout(function() {
                    scope.uiShowCrudForm = true;
                });
            };

            scope.newEntity = function () {
                scope.selectedEntity = null;

                if (scope.uidl.formTypeSelector) {
                    scope.newEntityCreated({});
                } else {
                    scope.entityService.newDomainObject(metaType.name).then(
                        function (newObj) {
                            scope.newEntityCreated(newObj);
                        },
                        function (fault) {
                            scope.$emit(scope.uidl.qualifiedName + ':NewDomainObjectFailed', commandService.createFaultInfo(fault));
                        }
                    );
                }
            };

            scope.newEntityCreated = function(newObj) {
                scope.model.entity = newObj;
                scope.model.isNew = true;
                if (scope.uidl.form) {
                    scope.$broadcast(scope.uidl.form.qualifiedName + ':ModelSetter', scope.model.entity);
                } else if (scope.uidl.formTypeSelector) {
                    scope.$broadcast(scope.uidl.formTypeSelector.qualifiedName + ':ModelSetter', scope.model.entity);
                }

                $timeout(function () {
                    scope.uiShowCrudForm = true;
                });
            };

            scope.deleteEntity = function (entity) {
                if (!entity) {
                    return;
                }

                if (scope.uidl.mode !== 'Inline') {
                    scope.entityService.deleteEntity(entity).then(
                        function(result) {
                            scope.queryEntities();
                            scope.uiShowCrudForm = false;
                            scope.$emit(scope.uidl.qualifiedName + ':DeleteEntityCompleted');
                        },
                        function (fault) {
                            scope.$emit(scope.uidl.qualifiedName + ':DeleteEntityFailed', commandService.createFaultInfo(fault));
                        }
                    );
                } else {
                    for (var i = 0; i < scope.resultSet.length; i++) {
                        if(scope.resultSet[i] === entity) {
                           scope.resultSet.splice(i, 1);
                           break;
                        }
                    }                
                }
                scope.refresh();
            };

            scope.saveChanges = function (entity) {
                //scope.$broadcast(':global:FormValidating', { isValud: true });

                if (scope.uidl.mode !== 'Inline') {
                    scope.entityService.storeEntity(entity).then(
                        function() {
                            scope.$emit(scope.uidl.qualifiedName + ':StoreEntityCompleted');
                            scope.refresh();
                        },
                        function (fault) {
                            scope.$emit(scope.uidl.qualifiedName + ':StoreEntityFailed', commandService.createFaultInfo(fault));
                        }
                    );
                } else {
                    if (scope.model.isNew) {
                        scope.resultSet.push(entity);
                    }
                }

                scope.refresh();
            };

            scope.rejectChanges = function (entity) {
                scope.commandInProgress = false;
                scope.refresh();
            };

            scope.invokeEntityCommand = function (command) {
                scope.$emit(command.qualifiedName + ':Executing');
            }

            scope.invokeCommand = function (command) {
                scope.commandInProgress = true;
                if (command.kind==='Submit') {
                    var validationResult = { isValid: true };
                    scope.$broadcast(':global:FormValidating', validationResult);
                    $timeout(function() {
                        if (validationResult.isValid===true) {
                            scope.$emit(command.qualifiedName + ':Executing');
                        } else {
                            scope.commandInProgress = false;
                        }
                    });
                } else {
                    scope.$emit(command.qualifiedName + ':Executing');
                }
            }

            scope.$on(scope.uidl.qualifiedName + ':ModelSetter', function (event, data) {
                scope.commandInProgress = false;
                scope.resetCrudState();
                scope.resultSet = data;
                scope.selectedEntity = null;
                scope.requestAuthorization();
                scope.$broadcast(scope.uidl.qualifiedName + ':Grid:DataReceived', scope.resultSet);
            });

            scope.$on(scope.uidl.qualifiedName + ':Save:Executing', function (event) {
                scope.saveChanges(scope.model.entity);
            });
            scope.$on(scope.uidl.qualifiedName + ':Cancel:Executing', function (event) {
                scope.rejectChanges(scope.model.entity);
            });
            scope.$on(scope.uidl.qualifiedName + ':Delete:Executing', function (event) {
                scope.deleteEntity(scope.model.entity);
            });
            
            scope.$watch('selectedEntity', function(newValue, oldValue) {
                scope.$emit(scope.uidl.qualifiedName + ':SelectedEntityChanged', newValue);
            });
        }
    };

    //-----------------------------------------------------------------------------------------------------------------

    m_controllerImplementations['DataGrid'] = {
        implement: function (scope) {
            scope.metaType = scope.uidlService.getMetaType(scope.uidl.entityName);

            //var dataQuery = scope.uidl.dataQuery;

            if (scope.uidl.displayColumns && scope.uidl.displayColumns.length) {
                scope.gridColumns = scope.uidl.displayColumns;
            } else {
                scope.gridColumns = scope.uidl.defaultDisplayColumns;
            }
            
            if (scope.uidl.enableAutonomousQuery) {
                $timeout(function() {
                    var query = scope.entityService.newQueryBuilder(scope.uidl.entityName);
                    var preparedRequest = {
                        query: query,
                        data: { }
                    };
                    //scope.onRequestPrepared(null, preparedRequest);
                    scope.$broadcast(scope.uidl.qualifiedName + ':RequestPrepared', preparedRequest);
                });
            }
            
            //for (var i = 0; i < scope.gridColumns.length; i++) {
            //    var column = scope.gridColumns[i];
            //    column.metaType = scope.uidlService.getMetaType(column.declaringTypeName);
            //    column.metaProperty = column.metaType.properties[toCamelCase(column.navigations[column.navigations.length - 1])];
            //}

            //scope.displayProperties = Enumerable.From(scope.uidl.displayColumns).Select(function (name) {
            //    return metaType.properties[toCamelCase(name)];
            //}).ToArray();

            //scope.refresh = function () {
            //    scope.queryEntities();
            //};

            //scope.queryEntities = function () {
            //    scope.resultSet = null;
            //    if (scope.uidl.mode !== 'Inline') {
            //        scope.entityService.queryEntity(scope.uidl.entityName + dataQuery).then(function (data) {
            //            scope.resultSet = data.ResultSet;
            //        });
            //    } else {
            //        scope.resultSet = scope.parentModel.entity[scope.parentUidl.propertyName];
            //    }
            //};

            //scope.$on(scope.uidl.qualifiedName + ':Search:Executing', function (event) {
            //    dataQuery = "";
            //    scope.queryEntities();
            //});

            //scope.queryEntities();
        }
    };

    //-----------------------------------------------------------------------------------------------------------------

    m_controllerImplementations['Form'] = {
        implement: function (scope) {
            scope.metaType = scope.uidlService.getMetaType(scope.uidl.entityName);

            scope.tabSetIndex = 0;
            scope.plainFields = Enumerable.From(scope.uidl.fields).Where("$.modifiers!='Tab' && $.modifiers!='Section'").ToArray();
            scope.sectionFields = Enumerable.From(scope.uidl.fields).Where("$.modifiers=='Section'").ToArray();
            scope.tabSetFields = Enumerable.From(scope.uidl.fields).Where("$.modifiers=='Tab'").ToArray();

            scope.commandInProgress = false;

			if (scope.uidl.mode === 'StandaloneCreate') {
				scope.parentModel = {
				    entity: scope.entityService.newDomainObject(scope.metaType.name)
				};
			}

            scope.selectTab = function(index) {
                scope.tabSetIndex = index;
            };

            scope.invokeCommand = function (command) {
                scope.commandInProgress = true;
                if (command.kind==='Submit') {
                    var validationResult = { isValid: true };
                    scope.$broadcast(':global:FormValidating', validationResult);
                    $timeout(function() {
                        if (validationResult.isValid===true) {
                            scope.$emit(command.qualifiedName + ':Executing');
                        } else {
                            scope.commandInProgress = false;
                        }
                    });
                } else {
                    scope.$emit(command.qualifiedName + ':Executing');
                }
            }

            scope.validate = function(deferred) {
                var result = true;

                var validateFuncName = 'validateWidget_Form';
                var validateFunc = window[validateFuncName];
                if (typeof validateFunc === 'function') {
                    result = validateFunc($scope);
                }

                for (var i = 0; i < scope.uidl.fields.length; i++) {
                    if (scope.uidl.fields[i].nestedWidget) {
                        
                    }
                }
            };

            scope.$on(scope.uidl.qualifiedName + ':ModelSetter', function(event, data) {
                scope.model.Data.entity = data;
                scope.commandInProgress = false;
                scope.tabSetIndex = 0;

                $timeout(function() {
                    Enumerable.From(scope.uidl.fields)
                        .Where("$.fieldType=='InlineGrid' || $.fieldType=='InlineForm' || $.fieldType=='LookupMany'")
                        .ForEach(function (field) {
                            scope.$broadcast(field.nestedWidget.qualifiedName + ':ModelSetter', data[field.propertyName]);
                        });
                });
            });

            scope.$on(scope.uidl.qualifiedName + ':StateResetter', function (event, data) {
                scope.commandInProgress = false;
                scope.tabSetIndex = 0;
            });
        }
    };

    //-----------------------------------------------------------------------------------------------------------------

    m_controllerImplementations['Text'] = {
        implement: function (scope) {
            scope.model.State.Contents = scope.uidl.text;
            
            scope.$on(scope.uidl.qualifiedName + ':FormatSetter', function(event, data) {
                scope.model.State.Contents = data;
            });
        }
    };

    //-----------------------------------------------------------------------------------------------------------------

    m_controllerImplementations['TransactionForm'] = {
        implement: function (scope) {
            scope.model.State.Input = { };
        }
    };

    //-----------------------------------------------------------------------------------------------------------------

    m_controllerImplementations['EntityMethodForm'] = {
        implement: function (scope) {
            scope.$on(scope.uidl.qualifiedName + ':ShowModal', function(event, data) {
                scope.commandInProgress = false;
                if (scope.model.State.entity) {
                    scope.model.State.Input = { 
                        '$entityId' : scope.model.State.entity['$id']
                    };
                    scope.model.State.Input = scope.model.State.Input; 
                    scope.$broadcast(scope.uidl.inputForm.qualifiedName + ':ModelSetter', scope.model.State.Input);
                } else {
                    scope.$emit(scope.uidl.qualifiedName + ':NoEntityWasSelected');
                }
            });
            
            scope.invokeCommand = function (command) {
                if (command.kind==='Submit') {
                    scope.commandInProgress = true;
                    var validationResult = { isValid: true };
                    scope.$broadcast(':global:FormValidating', validationResult);
                    $timeout(function() {
                        if (validationResult.isValid===true) {  
                            scope.$emit(command.qualifiedName + ':Executing');
                            scope.$broadcast(scope.uidl.qualifiedName + ':HideModal');
                        } else {
                            scope.commandInProgress = false;
                        }
                    });
                } else {
                    scope.$broadcast(scope.uidl.qualifiedName + ':HideModal');
                }
            };
        }
    };
    
    //-----------------------------------------------------------------------------------------------------------------

    m_controllerImplementations['LookupGrid'] = {
        implement: function (scope) {
            var metaType = scope.uidlService.getMetaType(scope.uidl.entityName);
            scope.metaType = metaType;

            if (scope.uidl.displayColumns && scope.uidl.displayColumns.length) {
                scope.gridColumns = scope.uidl.displayColumns;
            } else {
                scope.gridColumns = scope.uidl.defaultDisplayColumns;
            }

            scope.queryLookupRecords = function () {
                scope.lookupRecords = null;
                scope.entityService.queryEntity(scope.uidl.entityName).then(function (data) {
                    scope.lookupRecords = data.ResultSet;
                    var modelAsEnumerable = Enumerable.From(scope.model); 
                    for (var i = 0; i < scope.lookupRecords.length; i++) {
                        var record = scope.lookupRecords[i];
                        record.isChecked = modelAsEnumerable.Any("$ == '" + record['$id'] + "'");
                    }
                    $timeout(function () {
                        scope.$broadcast(scope.uidl.qualifiedName + ':DataReceived', scope.lookupRecords);
                    });
                });
            };

            scope.refresh = function () {
                scope.queryLookupRecords();
            };

            scope.updateCheckboxModel = function (entityId, isChecked) {
                //var entityId = scope.lookupRecords[rowIndex]['$id'];
                var model = scope.model;

                for (var i = model.length - 1; i >= 0; i--) {
                    if (model[i] === entityId) {
                        model.splice(i, 1);
                    }
                }

                if (isChecked) {
                    model.push(entityId);
                }
            };

            scope.$on(scope.uidl.qualifiedName + ':ModelSetter', function (event, data) {
                scope.model = data;
                scope.queryLookupRecords();
            });
        }
    };

    //-----------------------------------------------------------------------------------------------------------------

    m_controllerImplementations['TypeSelector'] = {
        implement: function (scope) {
            scope.selectedType = { name: null };
            scope.parentModelProperty = toCamelCase(scope.uidl.parentModelProperty);
            
            scope.selectedTypeChanged = function (type) {
                scope.entityService.newDomainObject(type).then(function (newObj) {
                    scope.model = {
                        entity: newObj
                    };

                    scope.selectedType.name = newObj['$type'];
                    scope.selectTabByType(scope.selectedType.name);

                    if (scope.parentModel) {
                        if (scope.parentUidl) {
                            // parent is FORM FIELD
                            scope.parentModel[scope.parentUidl.propertyName] = newObj;
                        } else {
                            // parent is CRUD
                            scope.parentModel[scope.parentModelProperty] = newObj;
                        }
                        scope.sendModelToSelectedWidget();
                    }
                });
            };

            scope.sendModelToSelectedWidget = function () {
                var selection = Enumerable.From(scope.uidl.selections).Where("$.typeName=='" + scope.selectedType.name + "'").First();
                var selectedWidgetQualifiedName = selection.widget.qualifiedName;
                $timeout(function() {
                    scope.$broadcast(selectedWidgetQualifiedName + ':ModelSetter', scope.model.entity);
                });
            };

            scope.parentModelReceived = function() {
                if (scope.parentUidl) {
                    // parent is FORM FIELD
                    scope.model.entity = scope.parentModel[scope.parentUidl.propertyName];
                } else if (scope.parentModel) {
                    // parent is CRUD
                    scope.model.entity = scope.parentModel[scope.parentModelProperty];
                }

                if (scope.model.entity) {
                    scope.selectedType.name = scope.model.entity['$type'];
                    scope.selectTabByType(scope.selectedType.name);
                }
            };
            
            scope.selectTabByIndex = function(index) {
                if (index !== scope.selectedTabIndex) {
                    scope.selectedTabIndex = index;
                    scope.$emit(scope.uidl.qualifiedName + ':SelectionChanged', scope.uidl.selections[index]);
                    $timeout(function() {
                        scope.$broadcast(scope.uidl.selections[index].widget.qualifiedName + ':NavigatedHere');
                    });
                }
            }

            scope.selectTabByType = function(typeName) {
                var newTabIndex = Enumerable.From(scope.uidl.selections).Select('sel=>sel.typeName').IndexOf(typeName);
                scope.selectTabByIndex(newTabIndex >= 0 ? newTabIndex : 0);
            }
            
            scope.model = {
                entity: null
            };

            if (scope.parentModel) {
                scope.parentModelReceived();
            }

            scope.$on(scope.uidl.qualifiedName + ':ModelSetter', function (event, data) {
                if (data) {
                    if (scope.parentUidl) {
                        // parent is FORM FIELD
                        scope.parentModel[scope.parentUidl.propertyName] = data;
                    } else if (scope.parentModel) {
                        // parent is CRUD
                        scope.parentModel[scope.parentModelProperty] = data;
                    }
                    scope.parentModelReceived();
                    scope.sendModelToSelectedWidget();
                }
            });

            if (scope.model.entity) {
                scope.selectedType.name = scope.model.entity['$type'];
                scope.selectTabByType(scope.selectedType.name);
                scope.sendModelToSelectedWidget();
            } else if (scope.uidl.defaultTypeName) {
                scope.selectTabByType(scope.uidl.defaultTypeName);
            }
        }
    };

    //-----------------------------------------------------------------------------------------------------------------

    return {
        setDocument: setDocument,
        getApp: getApp,
        getCurrentScreen: getCurrentScreen,
        getCurrentLocale: getCurrentLocale,
        getMetaType: getMetaType,
        getRelatedMetaType: getRelatedMetaType,
        //takeMessagesFromServer: takeMessagesFromServer,
        implementController: implementController,
        translate: translate,
        loadTemplateById: loadTemplateById,
        selectValue: selectValue
    };

}]);

//---------------------------------------------------------------------------------------------------------------------

theApp.controller('appStart',
['$http', '$scope', '$rootScope', 'uidlService', 'entityService', 'commandService',
function ($http, $scope, $rootScope, uidlService, entityService, commandService) {

    $scope.pageTitle = 'LOADING . . .';

    $http.get('uidl.json').then(function (httpResult) {
        uidlService.setDocument(httpResult.data);

		$rootScope.app = uidlService.getApp();
		$rootScope.uidl = uidlService.getApp();
		$rootScope.entityService = entityService;
		$rootScope.uidlService = uidlService;
		$rootScope.commandService = commandService;
		$rootScope.appScope = $scope;

        $scope.uidl = $rootScope.app;
		uidlService.implementController($scope);

		$rootScope.currentScreen = uidlService.getCurrentScreen();
		$rootScope.currentLocale = uidlService.getCurrentLocale();
		$scope.pageTitle = $scope.translate($scope.app.text) + ' - ' + $scope.translate($scope.currentScreen.text);

        if ($scope.uidl.isUserAuthenticated===true) {
            $http.get('appState/restore').then(
                function(response) {
                    $scope.model.State = response.data;
                    $scope.$emit($scope.uidl.qualifiedName + ':UserAlreadyAuthenticated');
                }
            );
        }
        
        //commandService.startPollingMessages();
    });

    /*
    $rootScope.executeNotification = function(notification, callingScope) {
        for (var i = 0; i < notification.subscribers.length; i++) {
            $rootScope.executeBehavior(notification.subscribers[i], callingScope);
        }
    };

    $rootScope.executeBehavior = function(behavior, callingScope) {
        switch(behavior.behaviorType) {
            case 'Navigate':
                switch(behavior.targetType) {
                    case 'Screen':
                        var screen = Enumerable.From(uidl.screens).First(function(s) { return s.idName === behavior.targetIdName });
                        $rootScope.currentScreen = screen;
                        break;
                    case 'ScreenPart':
                        var screenPart = Enumerable.From(uidl.screenParts).First(function(s) { return s.idName === behavior.targetIdName });
                        $rootScope.$broadcast(behavior.containerQualifiedName + '.NavReq', screenPart);
                        break;
                }
                break;
            case 'InvokeCommand':
                $rootScope.$broadcast(behavior.commandQualifiedName + '_Executing');
                break;
        }
    };
    */
}]);

//---------------------------------------------------------------------------------------------------------------------

theApp.directive('uidlScreen', ['uidlService', 'entityService', function (uidlService, entityService) {
    return {
        scope: {
            uidl: '='
        },
        restrict: 'E',
        replace: true,
        link: function (scope, elem, attrs) {
            //console.log('uidlScreen::link', scope.uidl.qualifiedName);
            //uidlService.implementController(scope);
        },
        template: '<ng-include src="\'uidl-screen\'"></ng-include>',
        controller: function ($scope) {
            $scope.uidlService = uidlService;
            $scope.entityService = entityService;
            //console.log('uidlScreen::controller', $scope.uidl.qualifiedName);
            //uidlService.implementController($scope);
            $scope.$watch('uidl', function (newValue, oldValue) {
                console.log('uidlScreen::watch(uidl)', oldValue.qualifiedName, '->', $scope.uidl.qualifiedName);
                uidlService.implementController($scope);
            });
            //$scope.$on($scope.uidl.qualifiedName + ':NavigatingAway', function () {
            //    $scope.$destroy();
            //});
        }
    };
}]);

//---------------------------------------------------------------------------------------------------------------------

theApp.directive('uidlScreenPart', ['uidlService', 'entityService', function (uidlService, entityService) {
    return {
        scope: {
            uidl: '='
        },
        restrict: 'E',
        replace: true,
        link: function (scope, elem, attrs) {
            //console.log('uidlScreenPart::link', scope.uidl.qualifiedName);
            //uidlService.implementController(scope);
        },
        template: '<ng-include src="\'uidl-screen-part\'"></ng-include>',
        controller: function ($scope) {
            $scope.uidlService = uidlService;
            $scope.entityService = entityService;
            //console.log('uidlScreenPart::controller', $scope.uidl.qualifiedName);
            //uidlService.implementController($scope);
            $scope.$watch('uidl', function (newValue, oldValue) {
                console.log('uidlScreenPart::watch(uidl)', oldValue.qualifiedName, '->', $scope.uidl.qualifiedName);
                uidlService.implementController($scope);
            });
            //$scope.$on($scope.uidl.qualifiedName + ':NavigatingAway', function () {
            //    $scope.$destroy();
            //});
        }
    };
}]);

//---------------------------------------------------------------------------------------------------------------------

theApp.directive('uidlWidget', 
['uidlService', 'entityService', 'commandService', '$timeout', '$http', '$compile', '$rootScope',
function (uidlService, entityService, commandService, $timeout, $http, $compile, $rootScope) {
    var uniqueWidgetId = 1;

    return {
        scope: {
            uidl: '=',
            parentUidl: '=',
            parentModel: '=?'
        },
        restrict: 'E',
        replace: true,
        link: function (scope, elem, attrs) {
            scope.uniqueWidgetId = 'uidlWidget' + uniqueWidgetId++;
        },
        template: '<ng-include src="\'uidl-element-template/\' + uidl.templateName"></ng-include>',
        controller: function ($scope) {
            $scope.$timeout = $timeout;
            $scope.$http = $http;
            $scope.$compile = $compile;
            $scope.$rootScope = $rootScope;
            $scope.uidlService = uidlService;
            $scope.entityService = entityService;
            $scope.commandService = commandService;
            $scope.inlineUserAlert = { current: null };
            //console.log('uidlWidget::controller', $scope.uidl.qualifiedName);
            //uidlService.implementController($scope);
            $scope.$watch('uidl', function (newValue, oldValue) {
                console.log('uidlWidget::watch(uidl)', oldValue ? oldValue.qualifiedName : '0', '->', $scope.uidl ? $scope.uidl.qualifiedName : '0');

                if ($scope.uidl) {
                    uidlService.implementController($scope);

                    var initFuncName = 'initWidget_' + $scope.uidl.widgetType;
                    var initFunc = window[initFuncName];
                    if (typeof initFunc === 'function') {
                        initFunc($scope);
                    }
            
                    $timeout(function() {
                        $scope.$emit($scope.uidl.qualifiedName + ':Loaded');
                    });
                }
            });
            if ($scope.controllerInitCount) {
                $scope.controllerInitCount = $scope.controllerInitCount+1;
            } else {
                $scope.controllerInitCount = 1;
            }
            
            $scope.$on("$destroy", function() {
                if ($scope.uidl) {
                    console.log('uidlWidget::$destroy() - ', $scope.uidl.qualifiedName);
                } else {
                    console.log('uidlWidget::$destroy() - ??? ', uniqueWidgetId);
                }
            });            
        }
    };
}]);

//---------------------------------------------------------------------------------------------------------------------

theApp.directive('uidlGridField', ['uidlService', 'entityService', function (uidlService, entityService) {
    return {
        scope: {
            property: '=',
            value: '='
        },
        restrict: 'E',
        replace: true,
        link: function (scope, elem, attrs) {
        },
        templateUrl: 'uidl-element-template/GridField',
        controller: function ($scope) {
        }
    };
}]);

//---------------------------------------------------------------------------------------------------------------------

theApp.directive('uidlFormField',
['$timeout', '$rootScope', 'uidlService', 'entityService',
function ($timeout, $rootScope, uidlService, entityService) {
    return {
        scope: {
            parentUidl: '=',
            uidl: '=',
            entity: '='
        },
        restrict: 'E',
        replace: true,
        link: function (scope, elem, attrs) {
        },
        templateUrl: function(elem, attrs) {
            return 'uidl-element-template/' + (attrs.templateName || 'FormField');
        },
        //templateUrl: 'uidl-element-template/' + parentUidl.fieldsTemplateName, 
        //template: '<ng-include src="\'uidl-element-template/\' + parentUidl.fieldsTemplateName"></ng-include>',
        controller: function ($scope) {
            $scope.uidlService = uidlService;
            $scope.entityService = entityService;
            $scope.uniqueFieldId = $scope.parentUidl.elementName + '_' + $scope.uidl.propertyName;
            $scope.translate = $scope.uidlService.translate;
            $scope.hasUidlModifier = function (modifier) {
                return ($scope.uidl.modifiers.indexOf(modifier) > -1);
            };
            
            if ($scope.parentUidl.usePascalCase === false) {
                $scope.uidl.propertyName = toCamelCase($scope.uidl.propertyName);
            }

            if ($scope.uidl.fieldType==='Lookup') {
                if ($scope.uidl.lookupEntityName) {
                    var metaType = uidlService.getMetaType($scope.uidl.lookupEntityName);

                    $scope.lookupMetaType = metaType;
                    $scope.lookupValueProperty = ($scope.uidl.lookupValueProperty ? $scope.uidl.lookupValueProperty : '$id');
                    $scope.lookupTextProperty = ($scope.uidl.lookupDisplayProperty ? $scope.uidl.lookupDisplayProperty : metaType.defaultDisplayPropertyNames[0]);
                    $scope.lookupForeignKeyProperty = $scope.uidl.propertyName; // + '_FK';

                    $scope.isLoadingTypeAhead = false;
                    $scope.isTypeAheadResultSetEmpty = true;

                    $scope.loadTypeAhead = function(prefix) {
                        $scope.isLoadingTypeAhead = true;
                        $scope.entityService.queryEntity($scope.uidl.lookupEntityName, function(query) {
                            query.where($scope.lookupTextProperty, prefix, ':cn');
                        }).then(
                            function(data) {
                                $scope.lookupResultSet = data.ResultSet;
                                if ($scope.uidl.applyDistinctToLookup) {
                                    $scope.lookupResultSet = Enumerable.From($scope.lookupResultSet).Distinct('$.' + $scope.lookupTextProperty).ToArray();
                                }
                                $scope.isLoadingTypeAhead = false;
                                $scope.isTypeAheadResultSetEmpty = ($scope.lookupResultSet.length===0);
                                return $scope.lookupResultSet;
                            },
                            function(faultResponse) {
                                $scope.isLoadingTypeAhead = false;
                                $scope.isTypeAheadResultSetEmpty = true;
                            }
                        );
                    }
                    
                    $scope.formatTypeAheadItem = function(model) {
                        return model[$scope.lookupTextProperty];
                    }
                    
                    $scope.ellipsisClicked = function() {
                        var lookupContext = {
                            targetEntity: $scope.entity,
                            targetProperty: $scope.lookupForeignKeyProperty,
                            lookupMetaType: $scope.lookupMetaType,
                            lookupTextProperty: $scope.lookupTextProperty,
                            lookupValueProperty: $scope.lookupValueProperty,
                            dataGridUidl: $scope.uidl.nestedWidget
                        };
                        $rootScope.$broadcast(':global:AdvancedLookupRequest', lookupContext);
                    };
 
                    if ($scope.hasUidlModifier('DropDown') && !$scope.hasUidlModifier('TypeAhead')) {
                        $scope.entityService.queryEntity($scope.uidl.lookupEntityName).then(function(data) {
                            $scope.lookupResultSet = data.ResultSet;

                            if ($scope.uidl.applyDistinctToLookup) {
                                $scope.lookupResultSet = Enumerable.From($scope.lookupResultSet).Distinct('$.' + $scope.lookupTextProperty).ToArray();
                            }
                        });
                    }
                } else if ($scope.uidl.standardValues) {
                    $scope.lookupValueProperty = 'id';
                    $scope.lookupTextProperty = 'text';
                    $scope.lookupForeignKeyProperty = $scope.uidl.propertyName;
                    $scope.lookupResultSet = [];

                    for (var i = 0; i < $scope.uidl.standardValues.length; i++) {
                        var value = $scope.uidl.standardValues[i];
                        $scope.lookupResultSet.push({
                            id: value,
                            text: uidlService.translate(value)
                        });
                    }
                }
            }

            $scope.hiddenValues = { };
            $scope.$on($scope.parentUidl.qualifiedName + ':ModelSetter', function(event, data) {
                $scope.hiddenValues = { };
            });
            
            $timeout(function () {
                var initFuncName = 'initWidget_FormField';
                var initFunc = window[initFuncName];
                if (typeof initFunc === 'function') {
                    initFunc($scope);
                }
            });
        }
    };
}]);

//---------------------------------------------------------------------------------------------------------------------

theApp.directive('uidlEllipsisLookupSearch',
['$timeout', '$rootScope', 'uidlService', 'entityService',
function ($timeout, $rootScope, uidlService, entityService) {
    return {
        scope: {
        },
        restrict: 'E',
        replace: true,
        link: function (scope, elem, attrs) {
        },
        templateUrl: function(elem, attrs) {
            return 'uidl-element-template/' + (attrs.templateName || 'EllipsisLookupSearchModal');
        },
        controller: function ($scope) {
            $scope.invokeInitFunc = function() {
                var initFuncName = 'initWidget_EllipsisLookupSearchModal';
                var initFunc = window[initFuncName];
                if (typeof initFunc === 'function') {
                    initFunc($scope);
                } else {
                    $timeout($scope.invokeInitFunc);
                }
            };
            
            $scope.$on(':global:AdvancedLookupRequest', function(event, data) {
                $scope.lookupContext = data;
                $scope.showLookupSearchModal();
            });

            $scope.lookupObjectSelected = function(selectedObject) {
                $scope.hideLookupSearchModal();
                $scope.lookupContext.targetEntity[$scope.lookupContext.targetProperty] = selectedObject[$scope.lookupContext.lookupValueProperty];
                $scope.lookupContext = null;
            };

            $scope.clearSelection = function() {
                $scope.hideLookupSearchModal();
                $scope.lookupContext.targetEntity[$scope.lookupContext.targetProperty] = null;
                $scope.lookupContext = null;
            };

            $scope.invokeInitFunc();
        }
    };
}]);

//---------------------------------------------------------------------------------------------------------------------

theApp.directive('uidlUserAlertInline', ['uidlService', 'entityService', function (uidlService, entityService) {
    return {
        scope: {
            alert: '='
        },
        restrict: 'E',
        replace: false,
        templateUrl: 'uidl-user-alert-inline',
        link: function (scope, elem, attrs) {
            //console.log('uidlUserAlertInline::link');
            //uidlService.implementController(scope);
        },
        controller: function ($scope) {
            $scope.uidlService = uidlService;
            $scope.entityService = entityService;
            //console.log('uidlUserAlertInline::controller');
            uidlService.implementController($scope);
            $scope.answerAlert = function(choice) {
                $scope.alert.current.answer(choice);
                $scope.alert.current = null;
            }
        },
    }
}]);

//---------------------------------------------------------------------------------------------------------------------

theApp.directive('uidlController', ['$compile', '$parse', function ($compile, $parse) {
    return {
        scope: true,
        restrict: 'A',
        terminal: true,
        priority: 100000,
        link: function (scope, elem, attrs) {
            elem.attr('ng-controller', scope.uidl.qualifiedName);
            elem.removeAttr('uidl-controller');
            $compile(elem)(scope);
        }
    };
}]);

//---------------------------------------------------------------------------------------------------------------------

theApp.directive('uidlReportLookup', ['entityService', function(entityService) {
	return {
		scope: {
			entityMetaType: '='
		},
		templateUrl: 'uidl-element-template-report-lookup',
		controller: function($scope) {
			if ($scope.entityMetaType == null)
				return;
			
			entityService.queryEntity($scope.entityMetaType.name).then(function (data) {
				$scope.resultSet = data.results;
			});
		}
	}
}]);

//---------------------------------------------------------------------------------------------------------------------

theApp.filter('localized', ['$scope', function ($scope) {
    return function (stringId) {
        var localizedString = $scope.currentLocale.translations[stringId];
        if (localizedString) {
            return localizedString;
        }
        else {
            return stringId;
        }
    };
}]);

//---------------------------------------------------------------------------------------------------------------------

theApp.filter('reverse', function () {
    return function (items) {
        if (!items) {
            return items;
        }
        return items.slice().reverse();
    };
});

//---------------------------------------------------------------------------------------------------------------------

theApp.filter('twoColumnRows', function () {
    return function (items) {
        var rows = [];
        var rowCount = Math.floor(items.length / 2) + (items.length % 2);
        for (var i = 0; i < rowCount; i++) {
            rows.push(items[i]);
            if (rowCount + i < items.length) {
                items[i]['$nextCol'] = items[rowCount + i];
            }
        }
        return rows;
    };
});

//---------------------------------------------------------------------------------------------------------------------

theApp.filter('translated', ['uidlService', function(uidlService) {
    return function(s) {
        return uidlService.translate(s);
    };
}]);

