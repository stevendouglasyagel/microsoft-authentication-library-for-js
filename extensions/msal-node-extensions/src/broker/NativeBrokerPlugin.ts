/*
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import { AccountInfo, AuthenticationResult, AuthenticationScheme, Constants, IdTokenClaims, INativeBrokerPlugin, Logger, LoggerOptions, NativeRequest, NativeSignOutRequest, PromptValue } from "@azure/msal-common";
import { Account, addon, AuthParameters, AuthResult, ErrorStatus, MsalRuntimeError, ReadAccountResult, DiscoverAccountsResult, SignOutResult, LogLevel as MsalRuntimeLogLevel} from "@azure/msal-node-runtime";
import { NativeAuthError } from "../error/NativeAuthError";
import { version, name } from "../packageMetadata";

export class NativeBrokerPlugin implements INativeBrokerPlugin {
    private logger: Logger;
    
    constructor() {
        const defaultLoggerOptions: LoggerOptions = {
            loggerCallback: () => {},
            piiLoggingEnabled: false
        };
        this.logger = new Logger(defaultLoggerOptions, name, version); // Default logger
    }

    setLogger(loggerOptions: LoggerOptions): void {
        this.logger = new Logger(loggerOptions, name, version);
        const logCallback = (message: string, logLevel: MsalRuntimeLogLevel, containsPii: boolean) => {
            switch(logLevel) {
                case MsalRuntimeLogLevel.Trace:
                    if (containsPii) {
                        this.logger.tracePii(message);
                    } else {
                        this.logger.trace(message);
                    }
                    break;
                case MsalRuntimeLogLevel.Debug: 
                    if (containsPii) {
                        this.logger.tracePii(message);
                    } else {
                        this.logger.trace(message);
                    }
                    break;
                case MsalRuntimeLogLevel.Info:
                    if (containsPii) {
                        this.logger.infoPii(message);
                    } else {
                        this.logger.info(message);
                    }
                    break;
                case MsalRuntimeLogLevel.Warning:
                    if (containsPii) {
                        this.logger.warningPii(message);
                    } else {
                        this.logger.warning(message);
                    }
                    break;
                case MsalRuntimeLogLevel.Error:
                    if (containsPii) {
                        this.logger.errorPii(message);
                    } else {
                        this.logger.error(message);
                    }
                    break;
                case MsalRuntimeLogLevel.Fatal:
                    if (containsPii) {
                        this.logger.errorPii(message);
                    } else {
                        this.logger.error(message);
                    }
                    break;
                default:
                    if (containsPii) {
                        this.logger.infoPii(message);
                    } else {
                        this.logger.info(message);
                    }
                    break; 
            }
        };
        addon.RegisterLogger(logCallback, loggerOptions.piiLoggingEnabled);
    }

    async getAccountById(accountId: string, correlationId: string): Promise<AccountInfo> {
        this.logger.trace("NativeBrokerPlugin - getAccountById called", correlationId);
        const readAccountResult = await this.readAccountById(accountId, correlationId);
        const accountInfoResult = addon.GetAccountInfo(readAccountResult);
        if (this.isError(accountInfoResult)) {
            const { errorCode, errorStatus, errorContext, errorTag } = accountInfoResult as MsalRuntimeError;
            throw new NativeAuthError(ErrorStatus[errorStatus], errorContext, errorCode, errorTag);
        }
        return this.generateAccountInfo(accountInfoResult as Account);
    }

    async getAllAccounts(clientId:string, correlationId: string): Promise<AccountInfo[]> {
        this.logger.trace("NativeBrokerPlugin - getAllAccounts called", correlationId);
        return new Promise((resolve, reject) => {
            const resultCallback = (result: DiscoverAccountsResult | MsalRuntimeError) => {
                if (this.isError(result)) {
                    const { errorCode, errorStatus, errorContext, errorTag } = result as MsalRuntimeError;
                    reject(new NativeAuthError(ErrorStatus[errorStatus], errorContext, errorCode, errorTag));
                    return;
                }
                const { accounts } = result as DiscoverAccountsResult;
                const accountInfoResult = [];
                accounts.forEach((account: Account) => {
                    accountInfoResult.push(this.generateAccountInfo(account));
                });
                resolve(accountInfoResult);
            };

            const callback = new addon.DiscoverAccountsResultCallback(resultCallback);
            const asyncHandle = new addon.AsyncHandle();
            addon.DiscoverAccounts(clientId, correlationId, callback, asyncHandle);
        });
    }

    async acquireTokenSilent(request: NativeRequest): Promise<AuthenticationResult> {
        this.logger.trace("NativeBrokerPlugin - acquireTokenSilent called", request.correlationId);
        const authParams = this.generateRequestParameters(request);
        let readAccountResult;
        if (request.accountId) {
            readAccountResult = await this.readAccountById(request.accountId, request.correlationId);
        }

        return new Promise((resolve: (value: AuthenticationResult) => void, reject) => {
            const resultCallback = (result: AuthResult | MsalRuntimeError) => {
                if (this.isError(result)) {
                    const { errorCode, errorStatus, errorContext, errorTag } = result as MsalRuntimeError;
                    reject(new NativeAuthError(ErrorStatus[errorStatus], errorContext, errorCode, errorTag));
                    return;
                }
                const authenticationResult = this.getAuthenticationResult(request, result as AuthResult);
                resolve(authenticationResult);
            };
            const callback = new addon.AuthResultCallback(resultCallback);
            const asyncHandle = new addon.AsyncHandle();
            if (readAccountResult) {
                addon.AcquireTokenSilently(authParams, readAccountResult, request.correlationId, callback, asyncHandle);
            } else {
                addon.SignInSilently(authParams, request.correlationId, callback, asyncHandle);
            }
        });
    }

    async acquireTokenInteractive(request: NativeRequest): Promise<AuthenticationResult> {
        this.logger.trace("NativeBrokerPlugin - acquireTokenInteractive called", request.correlationId);
        const authParams = this.generateRequestParameters(request);
        let account;
        let readAccountResult;
        if (request.accountId) {
            readAccountResult = await this.readAccountById(request.accountId, request.correlationId);
        }

        return new Promise((resolve: (value: AuthenticationResult) => void, reject) => {
            const resultCallback = (result: AuthResult | MsalRuntimeError) => {
                if (this.isError(result)) {
                    const { errorCode, errorStatus, errorContext, errorTag } = result as MsalRuntimeError;
                    reject(new NativeAuthError(ErrorStatus[errorStatus], errorContext, errorCode, errorTag));
                    return;
                }
                const authenticationResult = this.getAuthenticationResult(request, result as AuthResult);
                resolve(authenticationResult);
            };
            const callback = new addon.AuthResultCallback(resultCallback);
            const asyncHandle = new addon.AsyncHandle();
            switch (request.prompt) {
                case PromptValue.LOGIN:
                case PromptValue.SELECT_ACCOUNT:
                case PromptValue.CREATE:
                    this.logger.info("Calling native interop SignInInteractively API", request.correlationId);
                    const loginHint = request.loginHint || Constants.EMPTY_STRING;
                    addon.SignInInteractively(authParams, request.correlationId, loginHint, callback, asyncHandle);
                    break;
                case PromptValue.NONE:
                    if (readAccountResult) {
                        this.logger.info("Calling native interop AcquireTokenSilently API", request.correlationId);
                        addon.AcquireTokenSilently(authParams, readAccountResult, request.correlationId, callback, asyncHandle);
                    } else {
                        this.logger.info("Calling native interop SignInSilently API", request.correlationId);
                        addon.SignInSilently(authParams, request.correlationId, callback, asyncHandle);
                    }
                    break;
                default:
                    if (readAccountResult) {
                        this.logger.info("Calling native interop AcquireTokenInteractively API", request.correlationId);
                        addon.AcquireTokenInteractively(authParams, readAccountResult, request.correlationId, callback, asyncHandle);
                    } else {
                        this.logger.info("Calling native interop SignInInteractively API", request.correlationId);
                        const loginHint = request.loginHint || Constants.EMPTY_STRING;
                        addon.SignIn(authParams, request.correlationId, loginHint, callback, asyncHandle);
                    }
                    break;
            }
        });
    }

    async signOut(request: NativeSignOutRequest): Promise<void> {
        this.logger.trace("NativeBrokerPlugin - signOut called", request.correlationId);

        const readAccountResult = await this.readAccountById(request.accountId, request.correlationId);

        return new Promise((resolve, reject) => {
            const resultCallback = (result: SignOutResult | MsalRuntimeError) => {
                if (this.isError(result)) {
                    const { errorCode, errorStatus, errorContext, errorTag } = result as MsalRuntimeError;
                    reject(new NativeAuthError(ErrorStatus[errorStatus], errorContext, errorCode, errorTag));
                    return;
                }
                resolve();
            };

            const callback = new addon.SignOutResultCallback(resultCallback);
            const asyncHandle = new addon.AsyncHandle();
            addon.SignOutSilently(request.clientId, request.correlationId, readAccountResult, callback, asyncHandle);
        });
    }

    private async readAccountById(accountId: string, correlationId: string): Promise<ReadAccountResult> {
        this.logger.trace("NativeBrokerPlugin - readAccountById called", correlationId);

        return new Promise((resolve, reject) => {
            const resultCallback = (result: ReadAccountResult | MsalRuntimeError) => {
                if (this.isError(result)) {
                    const { errorCode, errorStatus, errorContext, errorTag } = result as MsalRuntimeError;
                    reject(new NativeAuthError(ErrorStatus[errorStatus], errorContext, errorCode, errorTag));
                    return;
                }
                resolve(result as ReadAccountResult);
            };

            const callback = new addon.ReadAccountResultCallback(resultCallback);
            const asyncHandle = new addon.AsyncHandle();
            addon.ReadAccountById(accountId, correlationId, callback, asyncHandle);
        });
    }

    private generateRequestParameters(request: NativeRequest): AuthParameters {
        this.logger.trace("NativeBrokerPlugin - generateRequestParameters called", request.correlationId);
        const authParams = new addon.AuthParameters(request.clientId, request.authority);
        authParams.SetRedirectUri(request.redirectUri);
        authParams.SetRequestedScopes(request.scopes.join(" "));

        if (request.claims) {
            authParams.SetDecodedClaims(request.claims);
        }

        if (request.authenticationScheme === AuthenticationScheme.POP) {
            if (!request.resourceRequestMethod || !request.resourceRequestUri || !request.shrNonce) {
                throw new Error("Authentication Scheme set to POP but one or more of the following parameters are missing: resourceRequestMethod, resourceRequestUri, shrNonce");
            }
            const resourceUrl = new URL(request.resourceRequestUri);
            authParams.SetPopParams(request.resourceRequestMethod, resourceUrl.host, resourceUrl.pathname, request.shrNonce);
        }
        
        if (request.extraParameters) {
            Object.keys(request.extraParameters).forEach((key) => {
                authParams.SetAdditionalParameter(key, request.extraParameters[key]);
            });
        }

        return authParams;
    }

    private getAuthenticationResult(request: NativeRequest, authResult: AuthResult): AuthenticationResult {
        this.logger.trace("NativeBrokerPlugin - getAuthenticationResult called", request.correlationId);
        
        let fromCache: boolean;
        try {
            const telemetryJSON = JSON.parse(authResult.telemetryData);
            fromCache = !!telemetryJSON["is_cache"];
        } catch (e) {
            this.logger.error("NativeBrokerPlugin: getAuthenticationResult - Error parsing telemetry data. Could not determine if response came from cache.", request.correlationId);
        }

        let idTokenClaims: IdTokenClaims;
        try {
            idTokenClaims = JSON.parse(authResult.idToken);
        } catch (e) {
            throw new Error("Unable to parse idToken claims");
        }

        const accountInfo = this.generateAccountInfo(authResult.account, idTokenClaims);

        const result: AuthenticationResult = {
            authority: request.authority,
            uniqueId: idTokenClaims.oid || idTokenClaims.sub || "",
            tenantId: idTokenClaims.tid || "",
            scopes: authResult.grantedScopes.split(" "),
            account: accountInfo,
            idToken: authResult.rawIdToken,
            idTokenClaims: idTokenClaims,
            accessToken: authResult.accessToken,
            fromCache: fromCache,
            expiresOn: new Date(authResult.expiresOn * 1000),
            tokenType: authResult.isPopAuthorization ? AuthenticationScheme.POP : AuthenticationScheme.BEARER,
            correlationId: request.correlationId,
            fromNativeBroker: true
        };
        return result;
    }

    private generateAccountInfo(account: Account, idTokenClaims?: IdTokenClaims): AccountInfo {
        this.logger.trace("NativeBrokerPlugin - generateAccountInfo called");

        const accountInfo: AccountInfo = {
            homeAccountId: account.homeAccountId,
            environment: account.environment,
            tenantId: account.realm,
            username: account.username,
            localAccountId: account.localAccountId,
            name: account.displayName,
            idTokenClaims: idTokenClaims,
            nativeAccountId: account.accountId
        };
        return accountInfo;
    }

    private isError(result: Object): boolean {
        return result.hasOwnProperty("errorCode") ||
               result.hasOwnProperty("errorStatus") ||
               result.hasOwnProperty("errorContext") ||
               result.hasOwnProperty("errorTag");
    }
}
