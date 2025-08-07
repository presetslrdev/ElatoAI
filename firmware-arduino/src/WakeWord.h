#ifndef WAKEWORD_H
#define WAKEWORD_H

#include <Arduino.h>

class WakeWordDetector {
public:
    void begin();
    bool process(const int16_t* samples, size_t count);
private:
    uint32_t threshold = 3000; // simple energy threshold
    int consecutive = 0;
    const int required = 20;
};

#endif // WAKEWORD_H
