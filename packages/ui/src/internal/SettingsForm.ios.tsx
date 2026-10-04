/**
 * iOS: a settings form is the system's own (SwiftUI's Form, from
 * @expo/ui), grouped and inset as Settings is. One Host holds the whole
 * form, so SwiftUI lays it out and scrolls it; nothing in it is measured
 * by React Native. A filter's or sort's controls share one row, as menus;
 * a swipe removes such a row, and touch and hold drags it to reorder,
 * where the section allows it.
 */
import type { ReactElement } from "react";
import {
  Button,
  Form,
  HStack,
  Host,
  LabeledContent,
  ListForEach,
  Picker,
  Section,
  Text,
  TextField,
  Toggle,
} from "@expo/ui/swift-ui";
import { disabled, foregroundStyle, labelsHidden, multilineTextAlignment, onSubmit, pickerStyle, tag } from "@expo/ui/swift-ui/modifiers";
import type { SettingsFormProps, SettingsRow, SettingsSection } from "../controlSlots";

function Choice({ row, compact }: { row: Extract<SettingsRow, { kind: "choice" }>; compact?: boolean }) {
  return (
    <Picker
      label={row.label}
      selection={row.value}
      onSelectionChange={(next: string | number) => {
        if (String(next) !== row.value) row.onChange(String(next));
      }}
      modifiers={[
        pickerStyle(row.style ?? "menu"),
        ...(compact || row.style === "inline" || row.style === "segmented" ? [labelsHidden()] : []),
      ]}
    >
      {row.options.map((o) => (
        <Text key={o.value} modifiers={[tag(o.value)]}>
          {o.label}
        </Text>
      ))}
    </Picker>
  );
}

function Field({ row, compact }: { row: Extract<SettingsRow, { kind: "text" }>; compact?: boolean }) {
  // The text as typed, for Return: SwiftUI's submit says only that it happened.
  let typed = row.value;
  const field = (
    <TextField
      // A new id is a new field (another filter): start from its value.
      key={row.id}
      defaultValue={row.value}
      autoFocus={row.autoFocus}
      placeholder={row.placeholder ?? row.label}
      onValueChange={(value: string) => {
        typed = value;
        row.onChange(value);
      }}
      modifiers={[
        ...(compact || row.onSubmit ? [] : [multilineTextAlignment("trailing")]),
        ...(row.onSubmit ? [onSubmit(() => row.onSubmit!(typed))] : []),
      ]}
    />
  );
  // A field that submits (adding to a list) is the whole row, its label its placeholder.
  return compact || row.onSubmit ? field : <LabeledContent label={row.label}>{field}</LabeledContent>;
}

function Row({ row }: { row: SettingsRow }): ReactElement {
  switch (row.kind) {
    case "text":
      return <Field row={row} />;
    case "choice":
      return <Choice row={row} />;
    case "info":
      return (
        <LabeledContent label={row.label}>
          <Text modifiers={[foregroundStyle("secondary")]}>{row.value}</Text>
        </LabeledContent>
      );
    case "toggle":
      return <Toggle label={row.label} isOn={row.value} onIsOnChange={row.onChange} />;
    case "compound":
      return (
        <HStack spacing={8}>
          {row.parts.map((part) =>
            part.kind === "choice" ? (
              <Choice key={part.id} row={part} compact />
            ) : part.kind === "text" ? (
              <Field key={part.id} row={part} compact />
            ) : (
              <Row key={part.id} row={part} />
            ),
          )}
        </HStack>
      );
    case "action":
      return (
        <Button
          label={row.label}
          systemImage={row.role === "add" ? "plus.circle.fill" : undefined}
          role={row.role === "destructive" ? "destructive" : undefined}
          onPress={row.onPress}
          modifiers={row.disabled ? [disabled(true)] : []}
        />
      );
  }
}

function FormSection({ section }: { section: SettingsSection }) {
  const listed = section.rows.filter((r) => r.kind === "compound");
  const rest = section.rows.filter((r) => r.kind !== "compound");
  const editable = section.onRemove !== undefined || section.onMove !== undefined;
  return (
    <Section title={section.title} footer={section.footer !== undefined ? <Text>{section.footer}</Text> : undefined}>
      {editable && listed.length > 0 ? (
        <ListForEach
          onDelete={section.onRemove && ((indices: number[]) => indices.forEach((i) => section.onRemove!(i)))}
          onMove={
            section.onMove &&
            ((from: number[], to: number) => {
              const index = from[0];
              if (index === undefined) return;
              // SwiftUI's destination is the index the row goes before, in
              // the list as it was.
              section.onMove!(index, to > index ? to - 1 : to);
            })
          }
        >
          {listed.map((row) => (
            <Row key={row.id} row={row} />
          ))}
        </ListForEach>
      ) : (
        listed.map((row) => <Row key={row.id} row={row} />)
      )}
      {rest.map((row) => (
        <Row key={row.id} row={row} />
      ))}
    </Section>
  );
}

export function SettingsForm({ sections }: SettingsFormProps): ReactElement {
  return (
    <Host style={{ flex: 1 }}>
      <Form>
        {sections.map((section) => (
          <FormSection key={section.id} section={section} />
        ))}
      </Form>
    </Host>
  );
}
