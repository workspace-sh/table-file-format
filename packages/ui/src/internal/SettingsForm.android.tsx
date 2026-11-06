/**
 * Android: a settings form is Material's own (Compose's, from @expo/ui),
 * laid out as Android's Settings is: a list of rows under section
 * headings in the primary colour, each row a list item. A choice is a
 * row showing what's chosen, opening a menu of the options; a few options
 * side by side are a segmented button row; an option that's on or off is
 * a switch at the row's end; text is an outlined field. A filter's or
 * sort's controls share one row, as menus, with a menu at its end to
 * move or remove it, as Android has no swipe to delete in a form.
 *
 * Inside the settings sheet (Sheet.android) the form is part of the
 * sheet's own Compose tree, so the sheet's drag and the form's scroll are
 * one gesture; anywhere else it has a Host of its own.
 */
import { useContext, useState, type ReactElement } from "react";
import type { ImageSourcePropType } from "react-native";
import {
  Column,
  DropdownMenu,
  DropdownMenuItem,
  Host,
  Icon,
  IconButton,
  ListItem,
  OutlinedTextField,
  RadioButton,
  Row,
  SegmentedButton,
  SingleChoiceSegmentedButtonRow,
  Switch,
  Text,
  TextButton,
  useMaterialColors,
  useNativeState,
} from "@expo/ui/jetpack-compose";
import { clickable, fillMaxSize, fillMaxWidth, imePadding, padding, selectable, toggleable, verticalScroll, weight } from "@expo/ui/jetpack-compose/modifiers";
import type { SettingsFormProps, SettingsFormSlot, SettingsRow, SettingsSection } from "../controlSlots";
import { InSettingsSheet } from "./settingsSheet";

// Material Symbols (weight 400) as vector drawables, which Compose's Icon draws.
const symbols = {
  add: require("./material/add.xml"),
  arrow_downward: require("./material/arrow_downward.xml"),
  arrow_upward: require("./material/arrow_upward.xml"),
  check: require("./material/check.xml"),
  delete: require("./material/delete.xml"),
  more_vert: require("./material/more_vert.xml"),
} satisfies Record<string, ImageSourcePropType>;

type Colors = ReturnType<typeof useMaterialColors>;

// Rows on the sheet's own surface, as Android's settings lists are; what's chosen in the secondary text colour.
const itemColors = (colors: Colors) => ({ containerColor: "transparent", supportingContentColor: colors.onSurfaceVariant });

function Choice({ row, compact, colors }: { row: Extract<SettingsRow, { kind: "choice" }>; compact?: boolean; colors: Colors }) {
  const [open, setOpen] = useState(false);
  const chosen = row.options.find((o) => o.value === row.value);
  const choose = (value: string) => {
    setOpen(false);
    if (value !== row.value) row.onChange(value);
  };
  if (!compact && row.style === "segmented") {
    return (
      <Column modifiers={[padding(16, 8, 16, 8)]}>
        <Text style={{ typography: "bodyLarge" }}>{row.label}</Text>
        <SingleChoiceSegmentedButtonRow modifiers={[fillMaxWidth(), padding(0, 8, 0, 0)]}>
          {row.options.map((o) => (
            <SegmentedButton key={o.value} selected={o.value === row.value} enabled={!o.disabled} onClick={() => choose(o.value)}>
              <SegmentedButton.Label>
                <Text>{o.label}</Text>
              </SegmentedButton.Label>
            </SegmentedButton>
          ))}
        </SingleChoiceSegmentedButtonRow>
      </Column>
    );
  }
  if (!compact && row.style === "inline") {
    return (
      <>
        {row.options.map((o) => (
          <ListItem colors={itemColors(colors)} key={o.value} modifiers={[selectable(o.value === row.value, () => choose(o.value), "radioButton")]}>
            <ListItem.LeadingContent>
              <RadioButton selected={o.value === row.value} enabled={!o.disabled} />
            </ListItem.LeadingContent>
            <ListItem.HeadlineContent>
              <Text>{o.label}</Text>
            </ListItem.HeadlineContent>
          </ListItem>
        ))}
      </>
    );
  }
  // The menu's options, the chosen one ticked.
  const items = (
    <DropdownMenu.Items>
      {row.options.map((o) => (
        <DropdownMenuItem key={o.value} enabled={!o.disabled} onClick={() => choose(o.value)}>
          <DropdownMenuItem.Text>
            <Text>{o.label}</Text>
          </DropdownMenuItem.Text>
          {o.value === row.value && (
            <DropdownMenuItem.TrailingIcon>
              <Icon source={symbols.check} size={24} tint={colors.onSurface} />
            </DropdownMenuItem.TrailingIcon>
          )}
        </DropdownMenuItem>
      ))}
    </DropdownMenu.Items>
  );
  if (compact) {
    // In a filter's or sort's row: a text button showing the choice, its menu under it.
    return (
      <DropdownMenu expanded={open} onDismissRequest={() => setOpen(false)}>
        <DropdownMenu.Trigger>
          <TextButton onClick={() => setOpen(true)}>
            <Text>{`${chosen?.label ?? row.label} ▾`}</Text>
          </TextButton>
        </DropdownMenu.Trigger>
        {items}
      </DropdownMenu>
    );
  }
  return (
    <DropdownMenu expanded={open} onDismissRequest={() => setOpen(false)}>
      <DropdownMenu.Trigger>
        <ListItem colors={itemColors(colors)} modifiers={[fillMaxWidth(), clickable(() => setOpen(true))]}>
          <ListItem.HeadlineContent>
            <Text>{row.label}</Text>
          </ListItem.HeadlineContent>
          <ListItem.SupportingContent>
            <Text>{chosen?.label ?? ""}</Text>
          </ListItem.SupportingContent>
        </ListItem>
      </DropdownMenu.Trigger>
      {items}
    </DropdownMenu>
  );
}

function Field({ row, compact }: { row: Extract<SettingsRow, { kind: "text" }>; compact?: boolean }) {
  // A new id is a new field (another filter): start from its value.
  return <FieldOf key={row.id} row={row} compact={compact} />;
}

function FieldOf({ row, compact }: { row: Extract<SettingsRow, { kind: "text" }>; compact?: boolean }) {
  // The field's text is native state, seeded once; edits come as onValueChange.
  const text = useNativeState(row.value);
  return (
    <OutlinedTextField
      value={text}
      autoFocus={row.autoFocus}
      singleLine
      onValueChange={row.onChange}
      keyboardOptions={row.onSubmit ? { imeAction: "done" } : undefined}
      keyboardActions={row.onSubmit ? { onDone: (value) => row.onSubmit!(value) } : undefined}
      modifiers={compact ? [weight(1)] : [fillMaxWidth(), padding(16, 4, 16, 4)]}
    >
      {compact || row.onSubmit ? (
        <OutlinedTextField.Placeholder>
          <Text>{row.placeholder ?? row.label}</Text>
        </OutlinedTextField.Placeholder>
      ) : (
        <OutlinedTextField.Label>
          <Text>{row.label}</Text>
        </OutlinedTextField.Label>
      )}
    </OutlinedTextField>
  );
}

/** A filter's or sort's row: its controls, then a menu to move or remove it. */
function Compound({
  row,
  index,
  count,
  section,
  colors,
}: {
  row: Extract<SettingsRow, { kind: "compound" }>;
  index: number;
  count: number;
  section: SettingsSection;
  colors: Colors;
}) {
  const [open, setOpen] = useState(false);
  const act = (f: () => void) => () => {
    setOpen(false);
    f();
  };
  const { onMove, onRemove } = section;
  return (
    <Row verticalAlignment="center" modifiers={[fillMaxWidth(), padding(8, 0, 4, 0)]}>
      <Row verticalAlignment="center" modifiers={[weight(1)]}>
        {row.parts.map((part) =>
          part.kind === "choice" ? (
            <Choice key={part.id} row={part} compact colors={colors} />
          ) : part.kind === "text" ? (
            <Field key={part.id} row={part} compact />
          ) : (
            <FormRow key={part.id} row={part} colors={colors} />
          ),
        )}
      </Row>
      {(onMove || onRemove) && (
        <DropdownMenu expanded={open} onDismissRequest={() => setOpen(false)}>
          <DropdownMenu.Trigger>
            <IconButton onClick={() => setOpen(true)}>
              <Icon source={symbols.more_vert} size={24} tint={colors.onSurfaceVariant} contentDescription="More" />
            </IconButton>
          </DropdownMenu.Trigger>
          <DropdownMenu.Items>
            {onMove && index > 0 && (
              <DropdownMenuItem onClick={act(() => onMove(index, index - 1))}>
                <DropdownMenuItem.LeadingIcon>
                  <Icon source={symbols.arrow_upward} size={24} tint={colors.onSurfaceVariant} />
                </DropdownMenuItem.LeadingIcon>
                <DropdownMenuItem.Text>
                  <Text>Move Up</Text>
                </DropdownMenuItem.Text>
              </DropdownMenuItem>
            )}
            {onMove && index < count - 1 && (
              <DropdownMenuItem onClick={act(() => onMove(index, index + 1))}>
                <DropdownMenuItem.LeadingIcon>
                  <Icon source={symbols.arrow_downward} size={24} tint={colors.onSurfaceVariant} />
                </DropdownMenuItem.LeadingIcon>
                <DropdownMenuItem.Text>
                  <Text>Move Down</Text>
                </DropdownMenuItem.Text>
              </DropdownMenuItem>
            )}
            {onRemove && (
              <DropdownMenuItem elementColors={{ textColor: colors.error }} onClick={act(() => onRemove(index))}>
                <DropdownMenuItem.LeadingIcon>
                  <Icon source={symbols.delete} size={24} tint={colors.error} />
                </DropdownMenuItem.LeadingIcon>
                <DropdownMenuItem.Text>
                  <Text>{row.removeLabel}</Text>
                </DropdownMenuItem.Text>
              </DropdownMenuItem>
            )}
          </DropdownMenu.Items>
        </DropdownMenu>
      )}
    </Row>
  );
}

function FormRow({ row, colors }: { row: SettingsRow; colors: Colors }): ReactElement {
  switch (row.kind) {
    case "text":
      return <Field row={row} />;
    case "choice":
      return <Choice row={row} colors={colors} />;
    case "info":
      return (
        <ListItem colors={itemColors(colors)} modifiers={[fillMaxWidth()]}>
          <ListItem.HeadlineContent>
            <Text>{row.label}</Text>
          </ListItem.HeadlineContent>
          <ListItem.SupportingContent>
            <Text>{row.value}</Text>
          </ListItem.SupportingContent>
        </ListItem>
      );
    case "toggle":
      // The whole row flips it, as Android's settings do; the switch shows it.
      return (
        <ListItem colors={itemColors(colors)} modifiers={[fillMaxWidth(), toggleable(row.value, () => row.onChange(!row.value), { role: "switch" })]}>
          <ListItem.HeadlineContent>
            <Text>{row.label}</Text>
          </ListItem.HeadlineContent>
          <ListItem.TrailingContent>
            <Switch value={row.value} />
          </ListItem.TrailingContent>
        </ListItem>
      );
    case "compound":
      // Drawn by its section, which knows its place among the others (Compound).
      return <></>;
    case "action": {
      const tint = row.disabled ? colors.onSurfaceVariant : row.role === "destructive" ? colors.error : colors.primary;
      return (
        <ListItem colors={itemColors(colors)} modifiers={[fillMaxWidth(), ...(row.disabled ? [] : [clickable(row.onPress)])]}>
          {row.role === "add" ? (
            <ListItem.LeadingContent>
              <Icon source={symbols.add} size={24} tint={tint} />
            </ListItem.LeadingContent>
          ) : null}
          <ListItem.HeadlineContent>
            <Text color={tint}>{row.label}</Text>
          </ListItem.HeadlineContent>
        </ListItem>
      );
    }
  }
}

function FormSection({ section, first, colors }: { section: SettingsSection; first: boolean; colors: Colors }) {
  const listed = section.rows.filter((r) => r.kind === "compound");
  const rest = section.rows.filter((r) => r.kind !== "compound");
  return (
    <Column modifiers={[fillMaxWidth(), padding(0, first ? 0 : 16, 0, 0)]}>
      {section.title !== undefined && (
        <Text color={colors.primary} style={{ typography: "titleSmall" }} modifiers={[padding(16, 8, 16, 8)]}>
          {section.title}
        </Text>
      )}
      {listed.map((row, i) => (
        <Compound key={row.id} row={row as Extract<SettingsRow, { kind: "compound" }>} index={i} count={listed.length} section={section} colors={colors} />
      ))}
      {rest.map((row) => (
        <FormRow key={row.id} row={row} colors={colors} />
      ))}
      {section.footer !== undefined && (
        <Text color={colors.onSurfaceVariant} style={{ typography: "bodySmall" }} modifiers={[padding(16, 4, 16, 8)]}>
          {section.footer}
        </Text>
      )}
    </Column>
  );
}

function Form({ sections }: SettingsFormProps): ReactElement {
  const colors = useMaterialColors();
  return (
    // The foot clear of the navigation bar, which the sheet runs under.
    <Column modifiers={[fillMaxSize(), verticalScroll(), imePadding(), padding(0, 0, 0, 72)]}>
      {sections.map((section, i) => (
        <FormSection key={section.id} section={section} first={i === 0} colors={colors} />
      ))}
    </Column>
  );
}

function SettingsFormView(props: SettingsFormProps): ReactElement {
  // In the settings sheet, part of its Compose tree; elsewhere, a Host of its own.
  if (useContext(InSettingsSheet)) return <Form {...props} />;
  return (
    <Host style={{ flex: 1 }}>
      <Form {...props} />
    </Host>
  );
}

export const SettingsForm: SettingsFormSlot = Object.assign(SettingsFormView, { reorderHint: "Use a row's menu to reorder." });
