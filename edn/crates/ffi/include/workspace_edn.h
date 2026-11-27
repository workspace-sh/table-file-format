// The C binding of workspace-edn (edn/crates/ffi), for the iOS and Mac apps.
// Text crosses as UTF-8 with its length, never NUL-terminated. Each
// EdnBytes and EdnColumns returned is the library's, given back once to
// edn_bytes_free or edn_columns_free. A call returns 0, or 1 with the error
// as JSON ({message, line, column}) in out's place.

#ifndef WORKSPACE_EDN_H
#define WORKSPACE_EDN_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
  uint8_t *ptr;
  size_t len;
} EdnBytes;

typedef struct {
  EdnBytes kinds;
  double *numbers;
  size_t numbers_len;
  EdnBytes extra;
  EdnBytes index;
} EdnColumns;

int32_t edn_canonical(const uint8_t *text, size_t len, EdnBytes *out);
int32_t edn_read(const uint8_t *text, size_t len, EdnBytes *out);
int32_t edn_formula(const uint8_t *text, size_t len, EdnBytes *out);
// The .table engine (edn/crates/table) as one call, in the shape of the actions
// engine's: an operation's name and its input, NUL-terminated UTF-8 (the input
// JSON), in; NUL-terminated JSON out, given back to edn_call_free. Never NULL:
// a mistake is {"error": "..."}. edn/crates/table/src/lib.rs lists the operations.
char *edn_call(const char *op, const char *input);
void edn_call_free(char *text);
// The exception for operations asked once per cell: a check of one text (1 yes,
// 0 no) or a number from one (0, in out); -1 when op isn't one.
int32_t edn_call_check(const char *op, const uint8_t *text, size_t len);
int32_t edn_call_number(const char *op, const uint8_t *text, size_t len, double *out);
// On 1, columns is untouched and error holds the error; on 0, error is untouched.
int32_t edn_compute_workbook(const uint8_t *json, size_t len, const double *numbers, size_t numbers_len, EdnColumns *columns, EdnBytes *error);
void edn_bytes_free(EdnBytes b);
void edn_columns_free(EdnColumns c);

#ifdef __cplusplus
}
#endif

#endif
