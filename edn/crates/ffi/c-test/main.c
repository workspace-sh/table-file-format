// Calls the C binding the way the apps' JSI module does, through the header alone.
#include <stdio.h>
#include <string.h>
#include "workspace_edn.h"

static int same(EdnBytes b, const char *want) { return b.len == strlen(want) && memcmp(b.ptr, want, b.len) == 0; }

int main(void) {
  int failed = 0;
  const char *t = "{:b 2 :a 1}";
  EdnBytes out;
  if (edn_canonical((const uint8_t *)t, strlen(t), &out) != 0 || !same(out, "{:a 1 :b 2}")) { printf("canonical: %.*s\n", (int)out.len, out.ptr); failed = 1; }
  edn_bytes_free(out);
  if (edn_canonical((const uint8_t *)"{:a", 3, &out) != 1 || out.len < 11 || memcmp(out.ptr, "{\"message\":", 11) != 0) { printf("error: %.*s\n", (int)out.len, out.ptr); failed = 1; }
  edn_bytes_free(out);
  const char *json = "{\"clock\":{\"today\":\"2026-10-26\",\"now\":\"2026-10-26T12:00:00Z\",\"seed\":1},\"tables\":[{\"name\":\"t\",\"ids\":[\"a\",\"b\"],\"views\":[],\"fields\":[{\"name\":\"n\",\"type\":\"number\",\"numbers\":0},{\"name\":\"twice\",\"type\":\"number\",\"formula\":\"(* n 2)\"}]}]}";
  double nums[] = {3.0, 4.5};
  EdnColumns cols; EdnBytes err;
  if (edn_compute_workbook((const uint8_t *)json, strlen(json), nums, 2, &cols, &err) != 0) { printf("workbook: %.*s\n", (int)err.len, err.ptr); edn_bytes_free(err); return 1; }
  int six = 0, nine = 0;
  for (size_t i = 0; i < cols.numbers_len; i++) { six |= cols.numbers[i] == 6.0; nine |= cols.numbers[i] == 9.0; }
  if (!six || !nine) { printf("workbook numbers wrong\n"); failed = 1; }
  edn_columns_free(cols);
  puts(failed ? "FAIL" : "ok");
  return failed;
}
