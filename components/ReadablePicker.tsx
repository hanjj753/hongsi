import React from 'react';
import { StyleSheet } from 'react-native';
import { Picker as NativePicker, type PickerItemProps, type PickerProps } from '@react-native-picker/picker';

type PickerValue = string | number | object;

function ReadablePicker<T extends PickerValue>(props: PickerProps<T>) {
  const children = React.Children.map(props.children, (child) => {
    if (!React.isValidElement<PickerItemProps<T>>(child) || child.type !== NativePicker.Item) return child;
    return React.cloneElement(child, { style: [child.props.style, styles.item] });
  });

  return (
    <NativePicker<T>
      {...props}
      style={[props.style, styles.picker]}
      itemStyle={[props.itemStyle, styles.item]}
    >
      {children}
    </NativePicker>
  );
}

export const Picker = Object.assign(ReadablePicker, { Item: NativePicker.Item });

const styles = StyleSheet.create({
  picker: {
    minHeight: 54,
    height: 54,
    paddingHorizontal: 12,
    fontSize: 16,
    color: '#111827',
  },
  item: { fontSize: 16, paddingVertical: 8 },
});
