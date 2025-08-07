#include "WakeWord.h"

void WakeWordDetector::begin() {
    consecutive = 0;
}

bool WakeWordDetector::process(const int16_t* samples, size_t count) {
    if (count == 0) {
        return false;
    }
    uint64_t sum = 0;
    for (size_t i = 0; i < count; ++i) {
        sum += abs(samples[i]);
    }
    uint32_t avg = sum / count;
    if (avg > threshold) {
        consecutive++;
        if (consecutive > required) {
            consecutive = 0;
            return true;
        }
    } else {
        consecutive = 0;
    }
    return false;
}
