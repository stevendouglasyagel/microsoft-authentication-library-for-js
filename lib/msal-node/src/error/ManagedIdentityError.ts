/*
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import { AuthError } from "@azure/msal-common";
import * as ManagedIdentityErrorCodes from "./ManagedIdentityErrorCodes";
export { ManagedIdentityErrorCodes };

/**
 * ManagedIdentityErrorMessage class containing string constants used by error codes and messages.
 */
export const ManagedIdentityErrorMessages = {
    [ManagedIdentityErrorCodes.invalidManagedIdentityIdType]:
        "More than one ManagedIdentityIdType was provided.",
    [ManagedIdentityErrorCodes.missingId]:
        "A ManagedIdentityId id was not provided.",
    [ManagedIdentityErrorCodes.unableToCreateSource]:
        "Unable to create a Managed Identity source based on environment variables.",
    [ManagedIdentityErrorCodes.urlParseError]:
        "The Managed Identity's 'IdentityEndpoint' environment variable is malformed.",
};

export class ManagedIdentityError extends AuthError {
    constructor(errorCode: string) {
        super(errorCode, ManagedIdentityErrorMessages[errorCode]);
        this.name = "ManagedIdentityError";
        Object.setPrototypeOf(this, ManagedIdentityError.prototype);
    }
}

export function createManagedIdentityError(
    errorCode: string
): ManagedIdentityError {
    return new ManagedIdentityError(errorCode);
}