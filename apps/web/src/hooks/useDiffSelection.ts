import { useState, useCallback, useEffect } from 'react';

export function useDiffSelection(
  files: string[], // List of file paths
  defaultChecked: boolean = true,
): [
  Record<string, boolean>, // checkedState: map of filePath to its boolean checked status
  (file: string) => void,  // toggleFile: function to toggle a single file's checked status
  (checkAll: boolean) => void, // setAllFiles: function to set all files to checked or unchecked
] {
  const [checkedState, setCheckedState] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const initialState: Record<string, boolean> = {};
    for (const file of files) {
      initialState[file] = defaultChecked;
    }
    setCheckedState(initialState);
  }, [files, defaultChecked]); // Re-initialize if files list or defaultChecked prop changes

  const toggleFile = useCallback((file: string) => {
    setCheckedState(prev => ({
      ...prev,
      [file]: !prev[file],
    }));
  }, []);

  const setAllFiles = useCallback((checkAll: boolean) => {
    setCheckedState(prev => {
      const newState = { ...prev };
      // Ensure we iterate over the current 'files' prop to handle dynamic lists
      for (const file of files) {
        newState[file] = checkAll;
      }
      return newState;
    });
  }, [files]); // Dependency on 'files' ensures it uses the latest list

  return [checkedState, toggleFile, setAllFiles];
}