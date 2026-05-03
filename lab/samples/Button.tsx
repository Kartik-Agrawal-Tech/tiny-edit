import { useState } from 'react';

interface ButtonProps {
  label: string;
  onPress: () => void;
}

export const Button = ({ label, onPress }: ButtonProps) => {
  const [count, setCount] = useState(0);
  const handle = () => {
    setCount(count + 1);
    onPress();
  };
  return <button onClick={handle}>{label} ({count})</button>;
};

export class Toggle extends React.Component<{ initial?: boolean }, { on: boolean }> {
  constructor(props: { initial?: boolean }) {
    super(props);
    this.state = { on: props.initial ?? false };
  }

  render() {
    return <span>{this.state.on ? 'ON' : 'OFF'}</span>;
  }
}
