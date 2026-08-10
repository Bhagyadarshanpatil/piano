import os
import glob
from generate_difficulties import process_file

INPUT_DIR = "inputs"
OUTPUT_DIR = "outputs"

def main():
    if not os.path.exists(INPUT_DIR):
        print(f"Error: '{INPUT_DIR}' directory not found.")
        print(f"Please create an '{INPUT_DIR}' folder and place your .mid files inside it.")
        return

    # Find all .mid and .midi files in the inputs directory
    midi_files = glob.glob(os.path.join(INPUT_DIR, "*.mid"))
    midi_files.extend(glob.glob(os.path.join(INPUT_DIR, "*.midi")))
    
    if not midi_files:
        print(f"No MIDI files found in '{INPUT_DIR}'.")
        return

    print(f"Found {len(midi_files)} files to process.\n")
    
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    success_count = 0
    for i, filepath in enumerate(midi_files, 1):
        filename = os.path.basename(filepath)
        print(f"[{i}/{len(midi_files)}] ------------------------------")
        try:
            process_file(filepath, out_dir=OUTPUT_DIR)
            success_count += 1
        except Exception as e:
            print(f"Failed to process '{filename}': {e}")
            
    print("\n==============================================")
    print(f"Batch processing complete! Successfully processed {success_count}/{len(midi_files)} files.")
    print(f"All generated difficulty files are located in the '{OUTPUT_DIR}' directory.")
    print("==============================================")

if __name__ == "__main__":
    main()
