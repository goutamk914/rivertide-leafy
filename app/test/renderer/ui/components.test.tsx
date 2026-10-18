// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { MotionConfig } from 'motion/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Button, Dialog, EmptyState, Field, IconButton, Keys, SegmentedControl, Select, Slider, TabPanel, TextInput, Toggle,
  ToastRegion, TOAST_DEFAULT_MS, TOOLTIP_HOVER_DELAY_MS, toast, useToastStore,
} from '../../../src/renderer/ui/components';
import { stubBrowserApis } from '../dashboard/helpers';

beforeEach(() => {
  stubBrowserApis();
  useToastStore.setState({ toasts: [] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Button', () => {
  it('blocks clicks and announces busy while loading', () => {
    // Arrange
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>Save key</Button>);
    const button = screen.getByRole('button', { name: 'Save key' });

    // Act
    fireEvent.click(button);

    // Assert
    expect(onClick).not.toHaveBeenCalled();
    expect(button.getAttribute('aria-busy')).toBe('true');
  });

  it('clicks normally when idle', () => {
    const onClick = vi.fn();
    render(<Button variant="accent" icon={Plus}>Add</Button>);
    render(<Button onClick={onClick}>Go</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('IconButton and Tooltip', () => {
  it('uses the label as its accessible name', () => {
    render(<IconButton label="New note" icon={Plus} />);
    expect(screen.getByRole('button', { name: 'New note' })).toBeTruthy();
  });

  it('shows the tooltip after the hover delay', () => {
    // Arrange
    vi.useFakeTimers();
    render(<IconButton label="New note" icon={Plus} />);
    const button = screen.getByRole('button', { name: 'New note' });

    // Act
    fireEvent.pointerEnter(button);
    const before = screen.queryByRole('tooltip', { hidden: true });
    act(() => vi.advanceTimersByTime(TOOLTIP_HOVER_DELAY_MS));

    // Assert
    expect(before).toBeNull();
    expect(screen.getByRole('tooltip', { hidden: true }).textContent).toBe('New note');
  });

  it('does not open the tooltip when the button is clicked', () => {
    render(<IconButton label="Pin note" icon={Plus} />);
    const button = screen.getByRole('button', { name: 'Pin note' });
    fireEvent.pointerDown(button);
    fireEvent.focus(button);
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();
  });

  it('shows the tooltip instantly on focus and hides on Escape', () => {
    render(<IconButton label="Pin note" icon={Plus} />);
    fireEvent.focus(screen.getByRole('button', { name: 'Pin note' }));
    expect(screen.getByRole('tooltip', { hidden: true })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();
  });
});

describe('Field', () => {
  it('wires the label, help and error to the control', () => {
    // Arrange + Act
    render(
      <Field label="Name" help="Optional" error="Use 80 characters or fewer.">
        <TextInput defaultValue="Sam" />
      </Field>,
    );
    const input = screen.getByLabelText('Name');

    // Assert
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const describedBy = input.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(describedBy)?.textContent).toBe('Use 80 characters or fewer.');
  });

  it('announces a new error through a live region that is always present', () => {
    // Arrange
    const { rerender, container } = render(<Field label="Name"><TextInput /></Field>);
    const live = container.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toBe('');

    // Act
    rerender(<Field label="Name" error="Enter a name."><TextInput /></Field>);

    // Assert
    expect(container.querySelector('[aria-live="polite"]')).toBe(live);
    expect(live?.textContent).toBe('Enter a name.');
    expect(screen.getByLabelText('Name').getAttribute('aria-invalid')).toBe('true');
  });

  it('works with Select', () => {
    const onChange = vi.fn();
    render(
      <Field label="Theme">
        <Select value="dark" onChange={onChange} options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }]} />
      </Field>,
    );
    fireEvent.change(screen.getByLabelText('Theme'), { target: { value: 'light' } });
    expect(onChange).toHaveBeenCalledWith('light');
  });
});

describe('Toggle and Slider', () => {
  it('is a switch that reports its new state', () => {
    const onChange = vi.fn();
    render(<Toggle label="Sounds" description="Play a soft sound" checked={false} onChange={onChange} />);
    const toggle = screen.getByRole('switch', { name: 'Sounds' });
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('does not save when the value did not change (e.g. tabbing across)', () => {
    const onCommit = vi.fn();
    render(<Slider label="Text size" value={1} min={0.9} max={1.5} step={0.05} onChange={() => undefined} onCommit={onCommit} />);
    const slider = screen.getByRole('slider', { name: 'Text size' });
    fireEvent.focus(slider);
    fireEvent.keyUp(slider, { key: 'Tab' });
    fireEvent.pointerUp(slider);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('reports changes and commits on release', () => {
    // Arrange
    const onCommit = vi.fn();
    function Harness() {
      const [value, setValue] = useState(1);
      return <Slider label="Text size" value={value} min={0.9} max={1.5} step={0.05} onChange={setValue} onCommit={onCommit} format={(v) => `${Math.round(v * 100)}%`} />;
    }
    render(<Harness />);
    const slider = screen.getByRole('slider', { name: 'Text size' });

    // Act
    fireEvent.focus(slider);
    fireEvent.change(slider, { target: { value: '1.2' } });
    fireEvent.pointerUp(slider);
    fireEvent.keyUp(slider, { key: 'Tab' });

    // Assert
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(1.2);
    expect(slider.getAttribute('aria-valuetext')).toBe('120%');
  });
});

describe('SegmentedControl', () => {
  function Harness({ mode }: { readonly mode: 'radio' | 'tabs' }) {
    const [value, setValue] = useState<'a' | 'b' | 'c'>('a');
    return (
      <MotionConfig reducedMotion="always">
        <SegmentedControl mode={mode} idBase="t" label="Show" value={value} onChange={setValue} options={[{ value: 'a', label: 'All' }, { value: 'b', label: 'Ask' }, { value: 'c', label: 'Leafy', disabled: true }]} />
        {mode === 'tabs' ? <TabPanel idBase="t" value={value}>Panel {value}</TabPanel> : null}
      </MotionConfig>
    );
  }

  it('moves selection with arrow keys and skips disabled options', () => {
    // Arrange
    render(<Harness mode="radio" />);
    const all = screen.getByRole('radio', { name: 'All' });

    // Act
    fireEvent.keyDown(all, { key: 'ArrowRight' });
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Ask' }), { key: 'ArrowRight' });

    // Assert
    expect(screen.getByRole('radio', { name: 'All' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(screen.getByRole('radio', { name: 'All' }), { key: 'End' });
    expect(screen.getByRole('radio', { name: 'Ask' }).getAttribute('aria-checked')).toBe('true');
  });

  it('switches tab panels', () => {
    render(<Harness mode="tabs" />);
    fireEvent.click(screen.getByRole('tab', { name: 'Ask' }));
    expect(screen.getByRole('tabpanel').textContent).toBe('Panel b');
    expect(screen.getByRole('tab', { name: 'Ask' }).getAttribute('aria-selected')).toBe('true');
  });
});

describe('Dialog', () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>Open</button>
        <Dialog open={open} onClose={() => setOpen(false)} title="Delete this chat?" actions={<button type="button">Delete chat</button>}>
          <input aria-label="First field" />
        </Dialog>
      </>
    );
  }

  it('skips roving (tabindex -1) items when trapping focus', async () => {
    // Arrange
    function Roving() {
      const [open, setOpen] = useState(true);
      return (
        <Dialog open={open} onClose={() => setOpen(false)} title="Set a timer" actions={<button type="button">Start</button>}>
          <button type="button" tabIndex={-1}>5 min</button>
          <button type="button">10 min</button>
        </Dialog>
      );
    }
    render(<Roving />);
    await act(() => new Promise((r) => requestAnimationFrame(() => r(null))));

    // Assert: first real tab stop is the selected segment, not the roving one.
    expect(document.activeElement?.textContent).toBe('10 min');
    const start = screen.getByRole('button', { name: 'Start' });
    start.focus();
    fireEvent.keyDown(start, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
  });

  it('focuses inside, traps Tab, closes on Escape and returns focus', async () => {
    // Arrange
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open' });
    opener.focus();

    // Act
    fireEvent.click(opener);
    await act(() => new Promise((r) => requestAnimationFrame(() => r(null))));

    // Assert
    expect(document.activeElement).toBe(screen.getByLabelText('First field'));
    const last = screen.getByRole('button', { name: 'Delete chat' });
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});

describe('Toasts', () => {
  it('dismisses info toasts after the default time but keeps errors', () => {
    // Arrange
    vi.useFakeTimers();
    render(<ToastRegion />);

    // Act
    act(() => {
      toast.success('Saved.');
      toast.error('Not saved. Check your connection.');
    });
    act(() => vi.advanceTimersByTime(TOAST_DEFAULT_MS + 10));

    // Assert
    expect(screen.queryByText('Saved.')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('Not saved.');
  });

  it('runs the action and reports how it closed', () => {
    const onUndo = vi.fn();
    const onClose = vi.fn();
    render(<ToastRegion />);
    act(() => {
      toast.info('Deleted.', { action: { label: 'Undo', onClick: onUndo }, onClose });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledWith('action');
  });

  it('runs the newest Undo with Command or Control Z, but not inside text fields', () => {
    // Arrange
    const onUndo = vi.fn();
    render(<><input aria-label="Draft" /><ToastRegion /></>);
    act(() => {
      toast.info('Deleted.', { action: { label: 'Undo', onClick: onUndo, shortcut: 'undo' } });
    });

    // Act
    fireEvent.keyDown(screen.getByLabelText('Draft'), { key: 'z', metaKey: true });
    const ignored = onUndo.mock.calls.length;
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });

    // Assert
    expect(ignored).toBe(0);
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Deleted.')).toBeNull();
  });

  it('stays usable while a dialog makes the app inert', () => {
    // Arrange
    const root = document.createElement('div');
    root.id = 'root';
    document.body.appendChild(root);
    render(<ToastRegion />, { container: root });
    root.setAttribute('inert', '');

    // Act
    act(() => {
      toast.error('Not saved.');
    });

    // Assert
    expect(screen.getByRole('alert').closest('[inert]')).toBeNull();
    root.remove();
  });

  it('reports dismissal', () => {
    const onClose = vi.fn();
    render(<ToastRegion />);
    act(() => {
      toast.info('Deleted.', { onClose });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onClose).toHaveBeenCalledWith('dismissed');
  });
});

describe('Keys and EmptyState', () => {
  it('reads a shortcut aloud', () => {
    render(<Keys keys="CommandOrControl+Shift+Space" />);
    expect(screen.getByRole('img', { name: 'Command Shift Space' }).querySelectorAll('kbd')).toHaveLength(3);
  });

  it('shows one sentence and one action', () => {
    render(<EmptyState title="No documents yet." action={<button type="button">Import</button>}>Add a handout.</EmptyState>);
    expect(screen.getByText('No documents yet.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Import' })).toBeTruthy();
  });
});
