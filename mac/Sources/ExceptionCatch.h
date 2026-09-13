#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Run `block` and turn an Objective-C exception into an NSError.
/// AVAudioEngine's `prepare` / `installTap` raise instead of returning NSError.
BOOL DSHCatchException(void (^block)(void), NSError *_Nullable *_Nullable error);

NS_ASSUME_NONNULL_END
