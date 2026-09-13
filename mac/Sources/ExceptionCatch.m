#import "ExceptionCatch.h"

BOOL DSHCatchException(void (^block)(void), NSError **error) {
    @try {
        block();
        return YES;
    } @catch (NSException *exception) {
        if (error != NULL) {
            *error = [NSError errorWithDomain:exception.name ?: @"NSException"
                                         code:0
                                     userInfo:@{
                NSLocalizedDescriptionKey: exception.reason ?: @"音频引擎异常",
            }];
        }
        return NO;
    }
}
